/**
 * Tenant schema v1 constraint proofs. Only minimal STRUCTURAL rows are
 * inserted (ids, codes, amounts) — nothing imitating real bookings or
 * suppliers; empty tables plus enforced invariants are the point.
 */

import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { applyMigrations } from "../migrations/apply";
import { TENANT_MIGRATIONS_DIR } from "../migrations/dirs";
import { loadMigrationDir } from "../migrations/loader";
import { createTestPlatform, expectDbRejection, pgAvailable, type TestPlatform } from "./helpers";

const available = await pgAvailable();

describe.skipIf(!available)("tenant schema v1", () => {
  let platform: TestPlatform;
  let sql: Sql;
  let accountA: string;
  let accountB: string;

  beforeAll(async () => {
    platform = await createTestPlatform();
    sql = await platform.createBareDb(`jenova_test_tenant_${platform.suffix}`);
    await applyMigrations(sql, await loadMigrationDir(TENANT_MIGRATIONS_DIR));
    const rows = await sql<{ id: string; code: string }[]>`
      insert into ledger_account (code, name, type, currency)
      values ('1000', 'a1', 'asset', 'SAR'), ('4000', 'a2', 'revenue', 'SAR')
      returning id, code
    `;
    accountA = rows.find((r) => r.code === "1000")?.id ?? "";
    accountB = rows.find((r) => r.code === "4000")?.id ?? "";
  });

  afterAll(async () => {
    await platform.destroy();
  });

  describe("journal balance (deferred, per transaction group, per currency)", () => {
    it("accepts a balanced transaction group", async () => {
      const group = randomUUID();
      await sql.begin(async (tx) => {
        await tx`
          insert into journal_entry (transaction_group_id, account_id, amount, currency)
          values (${group}, ${accountA}, 100, 'SAR'), (${group}, ${accountB}, -100, 'SAR')
        `;
      });
      const rows = await sql`select amount from journal_entry where transaction_group_id = ${group}`;
      expect(rows).toHaveLength(2);
    });

    it("rejects an unbalanced transaction group at commit", async () => {
      const group = randomUUID();
      await expectDbRejection(
        sql.begin(async (tx) => {
          await tx`
            insert into journal_entry (transaction_group_id, account_id, amount, currency)
            values (${group}, ${accountA}, 100, 'SAR')
          `;
        }),
        /does not balance/,
      );
      expect(await sql`select 1 from journal_entry where transaction_group_id = ${group}`).toHaveLength(0);
    });

    it("balances per currency — offsetting amounts in different currencies do not cancel", async () => {
      const group = randomUUID();
      await expectDbRejection(
        sql.begin(async (tx) => {
          await tx`
            insert into journal_entry (transaction_group_id, account_id, amount, currency)
            values (${group}, ${accountA}, 100, 'SAR'), (${group}, ${accountB}, -100, 'USD')
          `;
        }),
        /does not balance/,
      );
    });

    it("rejects zero-amount entries", async () => {
      const group = randomUUID();
      await expectDbRejection(
        sql`insert into journal_entry (transaction_group_id, account_id, amount, currency)
            values (${group}, ${accountA}, 0, 'SAR')`,
        /journal_entry_amount_check/,
      );
    });
  });

  describe("journal entries are immutable", () => {
    it("refuses UPDATE and DELETE", async () => {
      await expectDbRejection(sql`update journal_entry set amount = amount + 1`, /append-only/);
      await expectDbRejection(sql`delete from journal_entry`, /append-only/);
      await expectDbRejection(sql`truncate journal_entry`, /append-only/);
    });
  });

  describe("audit events are append-only", () => {
    it("accepts inserts, refuses UPDATE/DELETE/TRUNCATE", async () => {
      await sql`
        insert into audit_event (actor_type, actor_id, entity_type, entity_id, action, before, after)
        values ('system', null, 'e1', 'x', 'created', null, '{}'::jsonb)
      `;
      await expectDbRejection(sql`update audit_event set action = 'edited'`, /append-only/);
      await expectDbRejection(sql`delete from audit_event`, /append-only/);
      await expectDbRejection(sql`truncate audit_event`, /append-only/);
    });
  });

  describe("bookings and items", () => {
    it("client_reference is unique (idempotency) and states are constrained", async () => {
      const [booking] = await sql<{ id: string }[]>`
        insert into booking (client_reference, channel, currency)
        values ('ref1', 'b2b', 'SAR') returning id
      `;
      if (booking === undefined) throw new Error("insert returned no row");
      await expectDbRejection(
        sql`insert into booking (client_reference, channel, currency) values ('ref1', 'b2b', 'SAR')`,
        /duplicate key/,
      );
      await sql`
        insert into booking_item (booking_id, vertical, state, supplier_code, net_amount, sell_amount, currency, policy_snapshot)
        values (${booking.id}, 'hotel', 'quoted', 's1', 0, 0, 'SAR', '{}'::jsonb)
      `;
      await expectDbRejection(
        sql`
          insert into booking_item (booking_id, vertical, state, supplier_code, net_amount, sell_amount, currency, policy_snapshot)
          values (${booking.id}, 'hotel', 'teleported', 's1', 0, 0, 'SAR', '{}'::jsonb)
        `,
        /booking_item_state_check/,
      );
    });
  });

  describe("supplier accounts", () => {
    it("stores secrets only as an encrypted blob + key id, unique per supplier+environment", async () => {
      await sql`
        insert into supplier_account (supplier_code, environment, secrets_encrypted, secrets_key_id)
        values ('s1', 'sandbox', ${Buffer.from([1, 2, 3])}, 'k1')
      `;
      await expectDbRejection(
        sql`
          insert into supplier_account (supplier_code, environment, secrets_encrypted, secrets_key_id)
          values ('s1', 'sandbox', ${Buffer.from([4])}, 'k1')
        `,
        /duplicate key/,
      );
      const columns = await sql<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = 'supplier_account'
      `;
      const names = columns.map((c) => c.column_name);
      expect(names).toContain("secrets_encrypted");
      expect(names).toContain("secrets_key_id");
      expect(names.filter((n) => /password|secret/.test(n))).toEqual(["secrets_encrypted", "secrets_key_id"]);
    });
  });

  describe("markup rules", () => {
    it("ties currency presence to the value type (percent = bps, no currency)", async () => {
      await sql`insert into markup_rule (priority, value_type, value) values (10, 'percent', 500)`;
      await expectDbRejection(
        sql`insert into markup_rule (priority, value_type, value, currency) values (10, 'percent', 500, 'SAR')`,
        /markup_rule_value_is_money/,
      );
      await expectDbRejection(
        sql`insert into markup_rule (priority, value_type, value) values (10, 'fixed', 500)`,
        /markup_rule_value_is_money/,
      );
      await sql`insert into markup_rule (priority, value_type, value, currency) values (20, 'fixed', 500, 'SAR')`;
    });
  });

  describe("offers", () => {
    it("requires a TTL expiry after creation", async () => {
      await expectDbRejection(
        sql`
          insert into offer (supplier_code, vertical, net_amount, sell_amount, currency, price_hash, expires_at)
          values ('s1', 'hotel', 0, 0, 'SAR', 'h1', now() - interval '1 minute')
        `,
        /offer_expires_after_creation/,
      );
      await sql`
        insert into offer (supplier_code, vertical, net_amount, sell_amount, currency, price_hash, expires_at)
        values ('s1', 'hotel', 0, 0, 'SAR', 'h1', now() + interval '15 minutes')
      `;
    });
  });
});

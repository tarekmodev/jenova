/**
 * H1 regression suite (PR #42 adversarial review): the request path runs as
 * the least-privilege `jenova_runtime` role, NOT the schema owner — so the
 * attacks that defeated the trigger-level guarantees for an owner (DISABLE
 * TRIGGER USER, DROP TRIGGER, direct UPDATE/DELETE, session_replication_role)
 * must all fail here, while normal booking/ledger work succeeds.
 *
 * Every probe in this file executes on a connection authenticated as a LOGIN
 * member of jenova_runtime. Only minimal structural rows are inserted.
 */

import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { tenants } from "../control-plane/schema";
import { connectPg } from "../internal/pg";
import { createTenantDatabase } from "../provisioning";
import { createTestPlatform, expectDbRejection, pgAvailable, type TestPlatform } from "./helpers";

const available = await pgAvailable();

describe.skipIf(!available)("runtime role: least privilege binds the app path", () => {
  let platform: TestPlatform;
  let runtime: Sql; // authenticated as the jenova_runtime member — every probe below runs as this role
  let accountA: string;
  let accountB: string;

  beforeAll(async () => {
    platform = await createTestPlatform();
    const slug = `rt_${platform.suffix}`;
    await platform.controlPlane.db.insert(tenants).values({ slug, name: slug, baseCurrency: "SAR" });
    const provisioned = await createTenantDatabase(platform.controlPlane, slug);
    platform.registerDb(provisioned.dbName);

    runtime = connectPg(platform.runtimeDsn, provisioned.dbName, { max: 1 });
    platform.registerCleanup(() => runtime.end({ timeout: 1 }));

    const rows = await runtime<{ id: string; code: string }[]>`
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

  it("is a plain role: not superuser, not the table owner", async () => {
    const [me] = await runtime<{ usename: string; usesuper: boolean }[]>`
      select usename, usesuper from pg_user where usename = current_user
    `;
    expect(me?.usesuper).toBe(false);
    const [owner] = await runtime<{ tableowner: string }[]>`
      select tableowner from pg_tables where tablename = 'journal_entry'
    `;
    expect(owner?.tableowner).not.toBe(me?.usename);
    expect(owner?.tableowner).not.toBe("jenova_runtime");
  });

  it("normal booking + balanced ledger + audit work flows succeed", async () => {
    const [booking] = await runtime<{ id: string }[]>`
      insert into booking (client_reference, channel, currency) values ('rt_ref1', 'b2b', 'SAR') returning id
    `;
    if (booking === undefined) throw new Error("insert returned no row");
    await runtime`
      insert into booking_item (booking_id, vertical, state, supplier_code, net_amount, sell_amount, currency, policy_snapshot)
      values (${booking.id}, 'hotel', 'quoted', 's1', 0, 0, 'SAR', '{}'::jsonb)
    `;
    const group = randomUUID();
    await runtime.begin(async (tx) => {
      await tx`
        insert into journal_entry (transaction_group_id, account_id, amount, currency)
        values (${group}, ${accountA}, 100, 'SAR'), (${group}, ${accountB}, -100, 'SAR')
      `;
    });
    await runtime`
      insert into audit_event (actor_type, entity_type, entity_id, action, after)
      values ('system', 'e1', 'x', 'created', '{}'::jsonb)
    `;
    expect(await runtime`select 1 from journal_entry where transaction_group_id = ${group}`).toHaveLength(2);
  });

  it("cannot UPDATE or DELETE journal entries — denied at the privilege level", async () => {
    await expectDbRejection(runtime`update journal_entry set amount = amount + 1`, /permission denied/);
    await expectDbRejection(runtime`delete from journal_entry`, /permission denied/);
  });

  it("cannot UPDATE or DELETE audit events — denied at the privilege level", async () => {
    await expectDbRejection(runtime`update audit_event set action = 'edited'`, /permission denied/);
    await expectDbRejection(runtime`delete from audit_event`, /permission denied/);
  });

  it("cannot disable the triggers (the owner attack from the review)", async () => {
    await expectDbRejection(runtime`alter table journal_entry disable trigger user`, /must be owner/);
    await expectDbRejection(runtime`alter table audit_event disable trigger user`, /must be owner/);
  });

  it("cannot drop the balance or append-only triggers", async () => {
    await expectDbRejection(runtime`drop trigger journal_entry_balanced on journal_entry`, /must be owner/);
    await expectDbRejection(runtime`drop trigger journal_entry_no_update on journal_entry`, /must be owner/);
    await expectDbRejection(runtime`drop trigger audit_event_no_delete on audit_event`, /must be owner/);
  });

  it("cannot bypass triggers via session_replication_role (superuser-only)", async () => {
    await expectDbRejection(runtime`set session_replication_role = replica`, /permission denied/);
  });

  it("unbalanced transaction groups are still rejected at commit for the runtime role", async () => {
    const group = randomUUID();
    await expectDbRejection(
      runtime.begin(async (tx) => {
        await tx`
          insert into journal_entry (transaction_group_id, account_id, amount, currency)
          values (${group}, ${accountA}, 7777, 'SAR')
        `;
      }),
      /does not balance/,
    );
    expect(await runtime`select 1 from journal_entry where transaction_group_id = ${group}`).toHaveLength(0);
  });

  it("has no DDL: cannot create or drop tables", async () => {
    await expectDbRejection(runtime`create table rt_probe (id int)`, /permission denied/);
    await expectDbRejection(runtime`drop table journal_entry`, /must be owner/);
  });

  it("cannot write migration state", async () => {
    await expectDbRejection(
      runtime`insert into _jenova_migrations (name, checksum) values ('9999_fake.sql', 'x')`,
      /permission denied/,
    );
    await expectDbRejection(runtime`delete from _jenova_migrations`, /permission denied/);
  });
});

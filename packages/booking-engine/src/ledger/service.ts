/**
 * Ledger posting execution + reads (issue #69; CLAUDE.md rules 6/7).
 *
 * Postings are executed ONLY by the transition runner, inside the runner's
 * transaction — this module exposes no standalone write path. Reads are
 * ledger reads (balances are sums of journal entries, never recomputed from
 * bookings), and the invariant checker re-proves what the deferred database
 * trigger already enforces, so tests and CI can assert it independently of
 * trusting the trigger.
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Money } from "@jenova/domain";
import { assertValidMoney, zero } from "@jenova/domain";
import { journalEntries, ledgerAccounts } from "@jenova/db";
import {
  LedgerImbalanceError,
  MissingPenaltyResolutionError,
  MissingPostingTemplateError,
} from "../errors";
import type { TenantDbOrTx, TenantTx } from "../tx";
import { ensureLedgerAccounts, ledgerAccountCode, type LedgerAccountKey } from "./chart";
import {
  POSTING_TEMPLATES,
  templateUsesPenalty,
  type PostingTemplate,
  type TransitionEdge,
} from "./templates";

/** What a transition offers the template as amount sources. */
export interface PostingAmounts {
  /** Buyer-side price of the item (booking_item sell_amount + currency). */
  readonly sell: Money;
  /** Supplier-side net of the item (booking_item net_amount + currency). */
  readonly net: Money;
  /**
   * Cancellation penalty resolved BEFORE execution from the stored policy
   * (resolvePenaltyAt). `null` = resolved as free cancellation. `undefined`
   * = not resolved — refused on penalty-posting edges.
   */
  readonly penalty?: Money | null;
}

export interface PostedEntries {
  /** null when the edge's template has no lines (memo-only edges). */
  readonly transactionGroupId: string | null;
  readonly entryCount: number;
}

/** The template for an edge, or a typed refusal. */
export function requirePostingTemplate(edge: TransitionEdge): PostingTemplate {
  const template = POSTING_TEMPLATES[edge];
  if (template === undefined) {
    throw new MissingPostingTemplateError(edge);
  }
  return template;
}

/**
 * Executes one edge's posting template inside the caller's transaction.
 * DEBIT amounts are stored positive, CREDIT negative; zero-amount lines are
 * skipped (a free cancellation posts no penalty entries — the journal
 * forbids zero rows by check constraint).
 */
export async function postTransitionEntries(
  tx: TenantTx,
  edge: TransitionEdge,
  refs: { readonly bookingId: string; readonly bookingItemId: string },
  amounts: PostingAmounts,
  postedAt: Date,
): Promise<PostedEntries> {
  const template = requirePostingTemplate(edge);
  if (template.lines.length === 0) {
    return { transactionGroupId: null, entryCount: 0 };
  }
  assertValidMoney(amounts.sell);
  assertValidMoney(amounts.net);
  if (templateUsesPenalty(template) && amounts.penalty === undefined) {
    throw new MissingPenaltyResolutionError(edge);
  }
  const penalty = amounts.penalty ?? null;
  if (penalty !== null) {
    assertValidMoney(penalty);
  }

  const amountOf = (source: "sell" | "net" | "penalty"): Money => {
    if (source === "sell") return amounts.sell;
    if (source === "net") return amounts.net;
    return penalty ?? zero(amounts.net.currency);
  };

  const lines = template.lines
    .map((line) => ({ line, amount: amountOf(line.source) }))
    .filter(({ amount }) => amount.amount !== 0);
  if (lines.length === 0) {
    return { transactionGroupId: null, entryCount: 0 };
  }

  const accountIds = await ensureLedgerAccounts(
    tx,
    lines.map(({ line, amount }) => ({ key: line.account, currency: amount.currency })),
  );

  const transactionGroupId = randomUUID();
  await tx.insert(journalEntries).values(
    lines.map(({ line, amount }) => {
      const accountId = accountIds.get(ledgerAccountCode(line.account, amount.currency));
      if (accountId === undefined) {
        throw new Error(`account ${line.account}.${amount.currency} missing after ensure`);
      }
      return {
        transactionGroupId,
        accountId,
        amount: BigInt(line.direction === "debit" ? amount.amount : -amount.amount),
        currency: amount.currency,
        bookingId: refs.bookingId,
        bookingItemId: refs.bookingItemId,
        memo: `${edge} — ${line.memo}`,
        postedAt,
      };
    }),
  );
  return { transactionGroupId, entryCount: lines.length };
}

export interface UnbalancedGroup {
  readonly transactionGroupId: string;
  readonly currency: string;
  readonly total: bigint;
}

/**
 * Every transaction group's per-currency sum, filtered to the non-zero ones.
 * Empty result = the whole journal upholds debits === credits.
 */
export async function unbalancedTransactionGroups(
  db: TenantDbOrTx,
): Promise<readonly UnbalancedGroup[]> {
  const rows = await db
    .select({
      transactionGroupId: journalEntries.transactionGroupId,
      currency: journalEntries.currency,
      total: sql<string>`sum(${journalEntries.amount})`,
    })
    .from(journalEntries)
    .groupBy(journalEntries.transactionGroupId, journalEntries.currency)
    .having(sql`sum(${journalEntries.amount}) <> 0`);
  return rows.map((row) => ({
    transactionGroupId: row.transactionGroupId,
    currency: row.currency,
    total: BigInt(row.total),
  }));
}

/**
 * The ledger-invariant checker: throws LedgerImbalanceError when any group
 * fails debits === credits. Wired into service tests after every flow and
 * into the CI Postgres job as the nightly-style assertion over everything
 * the test run posted.
 */
export async function assertLedgerBalanced(db: TenantDbOrTx): Promise<void> {
  const groups = await unbalancedTransactionGroups(db);
  if (groups.length > 0) {
    throw new LedgerImbalanceError(groups);
  }
}

export interface AccountBalance {
  readonly code: string;
  readonly currency: string;
  readonly balance: bigint;
}

/** Trial balance: per-account journal sums (financial reports are ledger reads). */
export async function trialBalance(db: TenantDbOrTx): Promise<readonly AccountBalance[]> {
  const rows = await db
    .select({
      code: ledgerAccounts.code,
      currency: journalEntries.currency,
      balance: sql<string>`sum(${journalEntries.amount})`,
    })
    .from(journalEntries)
    .innerJoin(ledgerAccounts, eq(journalEntries.accountId, ledgerAccounts.id))
    .groupBy(ledgerAccounts.code, journalEntries.currency)
    .orderBy(ledgerAccounts.code);
  return rows.map((row) => ({
    code: row.code,
    currency: row.currency,
    balance: BigInt(row.balance),
  }));
}

/** Balance of one logical account in one currency (0n when never posted). */
export async function accountBalance(
  db: TenantDbOrTx,
  key: LedgerAccountKey,
  currency: string,
): Promise<bigint> {
  const code = ledgerAccountCode(key, currency);
  const rows = await db
    .select({ balance: sql<string | null>`sum(${journalEntries.amount})` })
    .from(journalEntries)
    .innerJoin(ledgerAccounts, eq(journalEntries.accountId, ledgerAccounts.id))
    .where(eq(ledgerAccounts.code, code));
  const value = rows[0]?.balance;
  return value === null || value === undefined ? 0n : BigInt(value);
}

/** Journal entries of one transaction group (audit/inspection read). */
export async function journalEntriesOfGroup(db: TenantDbOrTx, transactionGroupId: string) {
  return db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.transactionGroupId, transactionGroupId));
}

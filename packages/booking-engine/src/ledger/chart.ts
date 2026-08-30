/**
 * Minimal fixed chart of accounts (issue #69; docs/03 "LedgerAccount").
 *
 * One logical account per role; PHYSICAL rows are per currency because a
 * ledger_account row carries exactly one currency (0001 schema) and the
 * balance invariant holds per currency per transaction group. Rows are
 * seeded lazily and idempotently inside the posting transaction
 * (`on conflict (code) do nothing`) — no migration needed, and a tenant that
 * never trades a currency never grows accounts for it.
 *
 * VAT: sell-side postings carry VAT inside the sales line at M1 — the
 * breakdown that separates taxable base from VAT is stored on the Offer, and
 * a dedicated vat_output account arrives with fiscal-sa (M4) as a template
 * change, not a runner change.
 */

import { inArray } from "drizzle-orm";
import type { LedgerAccountType } from "@jenova/db";
import { ledgerAccounts } from "@jenova/db";
import type { TenantDbOrTx } from "../tx";

export const LEDGER_ACCOUNT_KEYS = [
  "agency_receivable",
  "sales",
  "cost_of_sales",
  "supplier_payable",
] as const;
export type LedgerAccountKey = (typeof LEDGER_ACCOUNT_KEYS)[number];

interface LedgerAccountDef {
  readonly name: string;
  readonly type: LedgerAccountType;
}

export const CHART_OF_ACCOUNTS: Readonly<Record<LedgerAccountKey, LedgerAccountDef>> = {
  agency_receivable: { name: "Agency receivables", type: "asset" },
  sales: { name: "Sales", type: "revenue" },
  cost_of_sales: { name: "Cost of sales", type: "expense" },
  supplier_payable: { name: "Supplier payables", type: "liability" },
};

/** Physical account code: logical key + currency, e.g. `sales.USD`. */
export function ledgerAccountCode(key: LedgerAccountKey, currency: string): string {
  return `${key}.${currency}`;
}

/**
 * Idempotently ensures the physical accounts for the given (key, currency)
 * pairs exist and returns code → account id. Safe under concurrency: the
 * unique code constraint arbitrates, `do nothing` swallows the loser, and
 * the follow-up select reads whichever row won.
 */
export async function ensureLedgerAccounts(
  tx: TenantDbOrTx,
  needs: readonly { key: LedgerAccountKey; currency: string }[],
): Promise<ReadonlyMap<string, string>> {
  const wanted = new Map<string, { key: LedgerAccountKey; currency: string }>();
  for (const need of needs) {
    wanted.set(ledgerAccountCode(need.key, need.currency), need);
  }
  if (wanted.size > 0) {
    await tx
      .insert(ledgerAccounts)
      .values(
        [...wanted.entries()].map(([code, { key, currency }]) => ({
          code,
          name: `${CHART_OF_ACCOUNTS[key].name} (${currency})`,
          type: CHART_OF_ACCOUNTS[key].type,
          currency,
        })),
      )
      .onConflictDoNothing({ target: ledgerAccounts.code });
  }
  const rows = await tx
    .select({ id: ledgerAccounts.id, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(inArray(ledgerAccounts.code, [...wanted.keys()]));
  const byCode = new Map<string, string>();
  for (const row of rows) {
    byCode.set(row.code, row.id);
  }
  for (const code of wanted.keys()) {
    if (!byCode.has(code)) {
      throw new Error(`ledger account ${code} could not be ensured`);
    }
  }
  return byCode;
}

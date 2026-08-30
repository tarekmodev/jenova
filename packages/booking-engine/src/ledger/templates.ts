/**
 * Ledger posting templates as DATA (issue #69; CLAUDE.md rule 7).
 *
 * One auditable table maps every M1 transition edge to its double-entry
 * lines. The runner executes templates inside the SAME transaction that
 * moves booking-item state; the database's deferred constraint trigger
 * proves each transaction group sums to zero per currency at COMMIT, and
 * `assertTemplatesBalanced` proves the same statically over this table.
 *
 * Sign convention: DEBIT entries are stored positive, CREDIT entries
 * negative — a group balances exactly when its per-currency sum is zero.
 *
 * Amount sources:
 * - `sell` — the buyer side: what the agency owes the tenant (booking_item
 *   sell_amount, item currency).
 * - `net`  — the supplier side: what the tenant owes the supplier (booking
 *   item net_amount, item currency; the net basis is post-FX per docs/03).
 * - `penalty` — the cancellation fee resolved from the stored normalized
 *   policy (resolvePenaltyAt) BEFORE execution; posted in the penalty's own
 *   currency (per-currency balancing makes mixed-currency groups legal).
 *
 * Edge semantics:
 * - quoted→reserved: HOLD MEMO ONLY — deliberately no financial posting.
 *   Reserving neither earns revenue nor owes the supplier; the commercial
 *   hold against the agency's credit line is the M3 credit engine's posting
 *   (credit_hold contra pair), which lands as new lines HERE, not as new
 *   runner code. The audit event is the hold's record until then.
 * - →confirmed: revenue recognition + supplier liability:
 *   DR agency_receivable / CR sales (sell) and
 *   DR cost_of_sales / CR supplier_payable (net).
 * - confirmed→cancelled: full reversal of the confirm postings, plus penalty
 *   postings for the non-refundable slice. The refundable delta is exactly
 *   what the reversal returns net of the penalty re-charge. At M1 the
 *   buyer-side penalty passes the supplier penalty through 1:1 (zero margin
 *   on cancellations); penalty markup pricing arrives with the credit
 *   engine/pricing work as a template change.
 * - pending_confirmation→cancelled: penalty postings only — confirm never
 *   posted, so there is nothing to reverse.
 * - →pending_confirmation / →failed: no financial postings (nothing has
 *   been recognized yet); the audit event carries the compensation notes.
 */

import type { BookingItemState } from "@jenova/domain";
import type { LedgerAccountKey } from "./chart";

export type PostingAmountSource = "sell" | "net" | "penalty";
export type PostingDirection = "debit" | "credit";

export interface PostingLine {
  readonly account: LedgerAccountKey;
  readonly source: PostingAmountSource;
  readonly direction: PostingDirection;
  readonly memo: string;
}

export interface PostingTemplate {
  /** Human-readable financial meaning — lands nowhere, documents the edge. */
  readonly description: string;
  readonly lines: readonly PostingLine[];
}

export type TransitionEdge = `${BookingItemState}->${BookingItemState}`;

export function transitionEdge(from: BookingItemState, to: BookingItemState): TransitionEdge {
  return `${from}->${to}`;
}

const CONFIRM_LINES: readonly PostingLine[] = [
  { account: "agency_receivable", source: "sell", direction: "debit", memo: "confirm: buyer receivable" },
  { account: "sales", source: "sell", direction: "credit", memo: "confirm: sales" },
  { account: "cost_of_sales", source: "net", direction: "debit", memo: "confirm: cost of sales" },
  { account: "supplier_payable", source: "net", direction: "credit", memo: "confirm: supplier payable" },
];

function reversed(lines: readonly PostingLine[], memoPrefix: string): readonly PostingLine[] {
  return lines.map((line) => ({
    ...line,
    direction: line.direction === "debit" ? "credit" : "debit",
    memo: `${memoPrefix}: reverse ${line.memo}`,
  }));
}

const PENALTY_LINES: readonly PostingLine[] = [
  { account: "agency_receivable", source: "penalty", direction: "debit", memo: "cancel: penalty receivable" },
  { account: "sales", source: "penalty", direction: "credit", memo: "cancel: penalty revenue" },
  { account: "cost_of_sales", source: "penalty", direction: "debit", memo: "cancel: penalty cost" },
  { account: "supplier_payable", source: "penalty", direction: "credit", memo: "cancel: penalty payable" },
];

/**
 * THE posting table. An M1 transition edge missing here cannot be executed
 * by the runner at all (MissingPostingTemplateError): every legal edge must
 * declare its financial meaning explicitly, even when that meaning is
 * "no postings".
 */
export const POSTING_TEMPLATES: Readonly<Partial<Record<TransitionEdge, PostingTemplate>>> = {
  "quoted->reserved": {
    description:
      "hold memo only — no financial posting; the credit-line hold posts here when the M3 credit engine lands",
    lines: [],
  },
  "reserved->pending_confirmation": {
    description: "supplier answered asynchronously — nothing recognized yet",
    lines: [],
  },
  "reserved->confirmed": {
    description: "revenue recognition + supplier liability",
    lines: CONFIRM_LINES,
  },
  "pending_confirmation->confirmed": {
    description: "revenue recognition + supplier liability (async confirmation settled)",
    lines: CONFIRM_LINES,
  },
  "confirmed->cancelled": {
    description: "reverse the confirm postings, then re-charge the cancellation penalty",
    lines: [...reversed(CONFIRM_LINES, "cancel"), ...PENALTY_LINES],
  },
  "pending_confirmation->cancelled": {
    description: "cancelled before confirmation — penalty only, nothing to reverse",
    lines: PENALTY_LINES,
  },
  "reserved->failed": {
    description: "supplier book failed after reserve — nothing recognized; audit carries compensation notes",
    lines: [],
  },
  "pending_confirmation->failed": {
    description: "async confirmation failed — nothing recognized; audit carries compensation notes",
    lines: [],
  },
};

/** Edges whose template posts penalty lines — the runner demands an explicit penalty resolution for these. */
export function templateUsesPenalty(template: PostingTemplate): boolean {
  return template.lines.some((line) => line.source === "penalty");
}

/**
 * Static invariant over the table itself: for every template and every
 * amount source, debits equal credits — a template that cannot balance can
 * never be committed, but it should not even be mergeable.
 */
export function assertTemplatesBalanced(
  templates: Readonly<Partial<Record<TransitionEdge, PostingTemplate>>> = POSTING_TEMPLATES,
): void {
  for (const [edge, template] of Object.entries(templates)) {
    if (template === undefined) continue;
    const bySource = new Map<PostingAmountSource, number>();
    for (const line of template.lines) {
      const sign = line.direction === "debit" ? 1 : -1;
      bySource.set(line.source, (bySource.get(line.source) ?? 0) + sign);
    }
    for (const [source, sum] of bySource) {
      if (sum !== 0) {
        throw new Error(`posting template ${edge} does not balance for source ${source}`);
      }
    }
  }
}

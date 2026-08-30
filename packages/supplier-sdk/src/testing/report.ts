/**
 * Certification report formatter (docs/05-suppliers.md): turns contract
 * suite results into the markdown run report attached to a supplier's
 * certification checklist. M0 stub — the M2 certification run wires vitest
 * reporter output into these types; the shape is the contract.
 */

import type { SupplierEnvironment } from "../contracts";

export const CERTIFICATION_CHECK_STATUSES = ["passed", "failed", "skipped", "todo"] as const;
export type CertificationCheckStatus = (typeof CERTIFICATION_CHECK_STATUSES)[number];

export interface CertificationCheck {
  /** Stable id, e.g. "lifecycle.search" or "error.sold_out". */
  readonly id: string;
  readonly title: string;
  readonly status: CertificationCheckStatus;
  readonly detail?: string;
}

export interface CertificationRunInfo {
  readonly supplierCode: string;
  readonly environment: SupplierEnvironment;
  /** "recorded" = sandbox-replay in CI; "live" = pre-certification sandbox run. */
  readonly mode: "recorded" | "live";
  /** ISO 8601 UTC instant of the run. */
  readonly ranAtUtc: string;
}

const STATUS_LABELS: Readonly<Record<CertificationCheckStatus, string>> = {
  passed: "PASS",
  failed: "FAIL",
  skipped: "SKIP",
  todo: "TODO",
};

function escapeCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

/**
 * Suite results → markdown. Verdict: CERTIFIABLE only when every check
 * passed on a LIVE run — recorded runs and any failed/todo/skipped check
 * report NOT CERTIFIABLE with the reason.
 */
export function formatCertificationReport(
  run: CertificationRunInfo,
  checks: readonly CertificationCheck[],
): string {
  const counts: Record<CertificationCheckStatus, number> = {
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
  };
  for (const check of checks) {
    counts[check.status] += 1;
  }

  const lines: string[] = [
    `# Certification run: ${run.supplierCode}`,
    "",
    `- Environment: ${run.environment}`,
    `- Mode: ${run.mode}`,
    `- Ran at: ${run.ranAtUtc}`,
    `- Checks: ${checks.length} (${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.todo} todo)`,
    "",
    "| Check | Status | Detail |",
    "|-------|--------|--------|",
  ];
  for (const check of checks) {
    lines.push(
      `| ${escapeCell(`${check.id} — ${check.title}`)} | ${STATUS_LABELS[check.status]} | ${escapeCell(check.detail ?? "")} |`,
    );
  }
  lines.push("");

  const incomplete = counts.failed + counts.skipped + counts.todo;
  if (incomplete === 0 && checks.length > 0 && run.mode === "live") {
    lines.push("**Verdict: CERTIFIABLE** — all checks passed against the live sandbox.");
  } else if (run.mode === "recorded") {
    lines.push(
      "**Verdict: NOT CERTIFIABLE** — recorded run; certification requires a clean live sandbox run.",
    );
  } else {
    lines.push(
      `**Verdict: NOT CERTIFIABLE** — ${counts.failed} failed, ${counts.skipped} skipped, ${counts.todo} todo.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

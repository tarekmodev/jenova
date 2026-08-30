/**
 * Fan-out migration CLI.
 *
 *   pnpm --filter @jenova/db migrate:fanout            # dry-run (default)
 *   pnpm --filter @jenova/db migrate:fanout -- --apply # apply everywhere
 *
 * Requires CONTROL_PLANE_DATABASE_URL (see .env.example). Exits non-zero if
 * any database failed.
 */

import process from "node:process";
import { connectControlPlane } from "../control-plane/client";
import { runFanout, type FanoutReport } from "../fanout";

function printReport(report: FanoutReport): void {
  const line = (label: string, s: { status: string; applied: string[]; pending: string[]; error?: string }): void => {
    const parts = [`${label}: ${s.status}`, `applied ${s.applied.length}`, `pending ${s.pending.length}`];
    if (s.pending.length > 0) parts.push(`(${s.pending.join(", ")})`);
    if (s.error !== undefined) parts.push(`— ${s.error}`);
    console.log(`  ${parts.join(" · ")}`);
  };
  console.log(`migration fan-out (${report.mode})`);
  line("control-plane", report.controlPlane);
  for (const tenant of report.tenants) {
    if (tenant.dbName === null) {
      console.log(`  tenant ${tenant.slug}: unprovisioned (no database yet)`);
      continue;
    }
    line(`tenant ${tenant.slug} [${tenant.dbName}]`, tenant);
  }
  console.log(report.ok ? "OK" : "FAILED — fix and re-run; completed databases are recorded and will be skipped");
}

const mode = process.argv.includes("--apply") ? "apply" : "dry-run";
const url = process.env.CONTROL_PLANE_DATABASE_URL;
if (url === undefined || url === "") {
  console.error("CONTROL_PLANE_DATABASE_URL is required (see .env.example)");
  process.exit(2);
}

const controlPlane = connectControlPlane({ url });
try {
  const report = await runFanout(controlPlane, { mode });
  printReport(report);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await controlPlane.close();
}

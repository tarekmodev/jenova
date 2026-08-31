/**
 * Process management for the harness: the REAL api (NODE_ENV=test → replay
 * transport + replay credentials seam) and the REAL portal (production
 * build, `next start`). No route is mocked anywhere.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../../..");
const API_DIR = path.join(REPO_ROOT, "apps", "api");
const PORTAL_DIR = path.join(REPO_ROOT, "apps", "portal-agent");

function resolveFrom(dir: string, specifier: string): string {
  return createRequire(path.join(dir, "package.json")).resolve(specifier);
}

export interface ApiEnv {
  readonly port: number;
  readonly controlPlaneUrl: string;
  readonly runtimeDsn: string;
  readonly redisUrl: string;
}

export function startApi(env: ApiEnv): ChildProcess {
  const tsxCli = resolveFrom(API_DIR, "tsx/cli");
  return spawn(process.execPath, [tsxCli, "src/main.ts"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      API_PORT: String(env.port),
      CONTROL_PLANE_DATABASE_URL: env.controlPlaneUrl,
      JENOVA_TENANT_RUNTIME_DSN: env.runtimeDsn,
      REDIS_URL: env.redisUrl,
      // Per-run key (rule 8): offers signed by THIS process only.
      OFFER_SIGNING_KEY: `e2e-run-signing-key-${Date.now().toString(36)}-0123456789abcdef`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function buildPortal(): void {
  if (process.env["JENOVA_E2E_SKIP_BUILD"] === "1") {
    return;
  }
  const nextBin = resolveFrom(PORTAL_DIR, "next/dist/bin/next");
  const result = spawnSync(process.execPath, [nextBin, "build"], {
    cwd: PORTAL_DIR,
    env: { ...process.env },
    stdio: "inherit",
    timeout: 600_000,
  });
  if (result.status !== 0) {
    throw new Error(`next build failed with status ${String(result.status)}`);
  }
}

export function startPortal(port: number, apiOrigin: string): ChildProcess {
  const nextBin = resolveFrom(PORTAL_DIR, "next/dist/bin/next");
  return spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: PORTAL_DIR,
    env: { ...process.env, JENOVA_API_ORIGIN: apiOrigin },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Polls a URL until it answers < 500, or throws after `timeoutMs`. */
export async function waitForHttp(url: string, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) {
        return;
      }
      lastError = new Error(`status ${String(response.status)}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for ${url}`, { cause: lastError });
}

export function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill();
    // Windows has no SIGKILL escalation on kill(); give it a beat, then force.
    setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5_000).unref();
  });
}

/** Mirrors a child's output into the harness log for post-mortems. */
export function pipeLogs(child: ChildProcess, label: string): void {
  const tag = (chunk: unknown): string =>
    String(chunk)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => `[${label}] ${line}`)
      .join("\n");
  child.stdout?.on("data", (chunk: unknown) => console.log(tag(chunk)));
  child.stderr?.on("data", (chunk: unknown) => console.error(tag(chunk)));
}

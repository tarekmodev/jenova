/**
 * Playwright global setup: throwaway control-plane + two tenants (ar/en
 * hosts), the real api in replay mode, the real portal production build.
 * Returns the teardown that kills both processes and force-drops every
 * per-run database.
 */

import { createTestPlatform, pgAvailable } from "@jenova/db/testing";
import { API_PORT, PORTAL_PORT, TENANT_HOSTS } from "./constants";
import { seedTenantForHost } from "./seed";
import {
  buildPortal,
  pipeLogs,
  startApi,
  startPortal,
  stop,
  waitForHttp,
} from "./servers";

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (!(await pgAvailable())) {
    throw new Error(
      "Agent Portal e2e needs local Postgres (docker compose up -d postgres redis) — refusing to fake it.",
    );
  }

  // Portal production build first — fail fast before any db work.
  buildPortal();

  const platform = await createTestPlatform();
  await seedTenantForHost(platform, "e2e_ar", TENANT_HOSTS.ar);
  await seedTenantForHost(platform, "e2e_en", TENANT_HOSTS.en);

  const api = startApi({
    port: API_PORT,
    controlPlaneUrl: platform.controlPlaneUrl,
    runtimeDsn: platform.runtimeDsn,
    redisUrl: process.env["REDIS_URL"] ?? "redis://localhost:6379",
  });
  pipeLogs(api, "api");
  const portal = startPortal(PORTAL_PORT, `http://localhost:${String(API_PORT)}`);
  pipeLogs(portal, "portal");

  try {
    await waitForHttp(`http://localhost:${String(API_PORT)}/health`);
    await waitForHttp(`http://localhost:${String(PORTAL_PORT)}/login`);
  } catch (error) {
    await stop(api);
    await stop(portal);
    await platform.destroy();
    throw error;
  }

  return async () => {
    await stop(portal);
    await stop(api);
    await platform.destroy();
  };
}

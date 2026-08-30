import { tenantId, type AppKey, type TenantId } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import { ApiHttpError } from "./errors";
import { createRequestContext, type RequestContext } from "./request-context";
import {
  AuthRealmStage,
  EntitlementStage,
  GATEWAY_STAGE_ORDER,
  GatewayPipeline,
  RateLimitStage,
  TenantResolutionStage,
  normalizeHost,
  parseRealmTaggedBearer,
  type GatewayRequestInfo,
  type GatewayStage,
  type GatewayStageName,
} from "./stages";
import type { TenantDirectory, TenantDirectoryEntry } from "./tenant-directory";

// Structural test values only — hosts/ids exist to exercise the chain shape.
const KNOWN_HOST = "tenant-one.example.test";
const KNOWN_TENANT = tenantId("tenant-one");
const KNOWN_DB = "tenant_one_db";

const directoryWithOneHost: TenantDirectory = {
  resolveByHost: (host: string): Promise<TenantDirectoryEntry | null> =>
    Promise.resolve(host === KNOWN_HOST ? { tenantId: KNOWN_TENANT, dbName: KNOWN_DB } : null),
};

function requestInfo(overrides: Partial<GatewayRequestInfo> = {}): GatewayRequestInfo {
  return { host: KNOWN_HOST, authorization: null, requiredApp: null, ...overrides };
}

function contextOf(): RequestContext {
  return createRequestContext("req-1");
}

async function errorFrom(promise: Promise<unknown>): Promise<ApiHttpError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiHttpError);
    return error as ApiHttpError;
  }
  throw new Error("expected the promise to reject");
}

describe("GatewayPipeline", () => {
  const recordingStage = (name: GatewayStageName, log: string[]): GatewayStage => ({
    name,
    run: (): Promise<void> => {
      log.push(name);
      return Promise.resolve();
    },
  });

  it("runs the four stages in the exact contract order", async () => {
    const log: string[] = [];
    const pipeline = new GatewayPipeline(GATEWAY_STAGE_ORDER.map((n) => recordingStage(n, log)));
    await pipeline.run(contextOf(), requestInfo());
    expect(log).toEqual(["tenant_resolution", "auth_realm", "entitlement", "rate_limit"]);
  });

  it("refuses assembly in any other order", () => {
    const log: string[] = [];
    const swapped = [...GATEWAY_STAGE_ORDER].reverse().map((n) => recordingStage(n, log));
    expect(() => new GatewayPipeline(swapped)).toThrowError(/must be exactly/);
  });

  it("refuses assembly with a missing stage", () => {
    const log: string[] = [];
    const truncated = GATEWAY_STAGE_ORDER.slice(0, 3).map((n) => recordingStage(n, log));
    expect(() => new GatewayPipeline(truncated)).toThrowError(/must be exactly/);
  });

  it("stops at the first refusing stage", async () => {
    const log: string[] = [];
    const stages = GATEWAY_STAGE_ORDER.map((n) => recordingStage(n, log));
    const refusing: GatewayStage = {
      name: "auth_realm",
      run: (): Promise<void> => Promise.reject(ApiHttpError.internal("refused")),
    };
    const pipeline = new GatewayPipeline([stages[0]!, refusing, stages[2]!, stages[3]!]);
    await expect(pipeline.run(contextOf(), requestInfo())).rejects.toBeInstanceOf(ApiHttpError);
    expect(log).toEqual(["tenant_resolution"]);
  });
});

describe("assembled pipeline (context propagation)", () => {
  it("threads ONE context through all four stages, each populating its slice", async () => {
    const seenByLimiter: RequestContext[] = [];
    const pipeline = new GatewayPipeline([
      new TenantResolutionStage(directoryWithOneHost),
      new AuthRealmStage(),
      new EntitlementStage({ isInstalled: () => Promise.resolve(true) }),
      new RateLimitStage({
        check: (context): Promise<void> => {
          seenByLimiter.push(context);
          return Promise.resolve();
        },
      }),
    ]);

    const context = contextOf();
    await pipeline.run(
      context,
      requestInfo({ authorization: "Bearer agency.opaque-credential", requiredApp: "b2b" }),
    );

    expect(context.requestId).toBe("req-1");
    expect(context.tenant).toEqual({ tenantId: KNOWN_TENANT, dbName: KNOWN_DB, host: KNOWN_HOST });
    expect(context.auth).toEqual({
      state: "unverified",
      realm: "agency",
      credential: "opaque-credential",
    });
    // The rate-limit seam saw the same, fully populated object.
    expect(seenByLimiter).toEqual([context]);
  });
});

describe("TenantResolutionStage", () => {
  const stage = new TenantResolutionStage(directoryWithOneHost);

  it("populates context.tenant for a known host", async () => {
    const context = contextOf();
    await stage.run(context, requestInfo());
    expect(context.tenant).toEqual({
      tenantId: KNOWN_TENANT,
      dbName: KNOWN_DB,
      host: KNOWN_HOST,
    });
  });

  it("normalizes casing and strips the port before resolving", async () => {
    const context = contextOf();
    await stage.run(context, requestInfo({ host: "Tenant-One.Example.Test:8443" }));
    expect(context.tenant?.host).toBe(KNOWN_HOST);
  });

  it("refuses an unknown host with a 404 tenant_not_found", async () => {
    const error = await errorFrom(stage.run(contextOf(), requestInfo({ host: "unknown.example.test" })));
    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe("tenant_not_found");
  });

  it("refuses a request with no Host header the same way", async () => {
    const error = await errorFrom(stage.run(contextOf(), requestInfo({ host: null })));
    expect(error.getStatus()).toBe(404);
    expect(error.code).toBe("tenant_not_found");
  });
});

describe("normalizeHost", () => {
  it("keeps IPv6 literals intact while stripping the port", () => {
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
    expect(normalizeHost("[::1]")).toBe("[::1]");
  });
});

describe("AuthRealmStage / parseRealmTaggedBearer", () => {
  it("records an anonymous context when no Authorization header is sent", async () => {
    const context = contextOf();
    await new AuthRealmStage().run(context, requestInfo());
    expect(context.auth).toEqual({ state: "anonymous" });
  });

  it("parses a realm-tagged bearer token as UNVERIFIED (crypto lands with #32)", () => {
    expect(parseRealmTaggedBearer("Bearer agency.opaque-credential")).toEqual({
      state: "unverified",
      realm: "agency",
      credential: "opaque-credential",
    });
  });

  it("keeps everything after the first dot as the opaque credential", () => {
    expect(parseRealmTaggedBearer("Bearer machine.a.b.c")).toEqual({
      state: "unverified",
      realm: "machine",
      credential: "a.b.c",
    });
  });

  it("treats an unknown realm tag or malformed shape as anonymous", () => {
    expect(parseRealmTaggedBearer("Bearer nosuchrealm.credential")).toEqual({ state: "anonymous" });
    expect(parseRealmTaggedBearer("Bearer no-dot-at-all")).toEqual({ state: "anonymous" });
    expect(parseRealmTaggedBearer("Bearer agency.")).toEqual({ state: "anonymous" });
    expect(parseRealmTaggedBearer("Basic something")).toEqual({ state: "anonymous" });
  });
});

describe("EntitlementStage", () => {
  const sourceInstalledOnly = (installedApp: AppKey, forTenant: TenantId) => ({
    calls: [] as Array<{ tenantId: TenantId; appKey: AppKey }>,
    isInstalled(id: TenantId, appKey: AppKey): Promise<boolean> {
      this.calls.push({ tenantId: id, appKey });
      return Promise.resolve(id === forTenant && appKey === installedApp);
    },
  });

  async function resolvedContext(): Promise<RequestContext> {
    const context = contextOf();
    await new TenantResolutionStage(directoryWithOneHost).run(context, requestInfo());
    return context;
  }

  it("passes an app-gated route when the tenant has the app installed", async () => {
    const source = sourceInstalledOnly("b2b", KNOWN_TENANT);
    const context = await resolvedContext();
    await new EntitlementStage(source).run(context, requestInfo({ requiredApp: "b2b" }));
    expect(source.calls).toEqual([{ tenantId: KNOWN_TENANT, appKey: "b2b" }]);
  });

  it("refuses a missing entitlement with a 403 app_not_installed", async () => {
    const source = sourceInstalledOnly("b2b", KNOWN_TENANT);
    const context = await resolvedContext();
    const error = await errorFrom(
      new EntitlementStage(source).run(context, requestInfo({ requiredApp: "crm" })),
    );
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe("app_not_installed");
  });

  it("never consults the source for a route that is not app-gated", async () => {
    const source = sourceInstalledOnly("b2b", KNOWN_TENANT);
    await new EntitlementStage(source).run(await resolvedContext(), requestInfo());
    expect(source.calls).toEqual([]);
  });

  it("flags a mis-assembled chain (no tenant) as an internal error", async () => {
    const source = sourceInstalledOnly("b2b", KNOWN_TENANT);
    const error = await errorFrom(
      new EntitlementStage(source).run(contextOf(), requestInfo({ requiredApp: "b2b" })),
    );
    expect(error.getStatus()).toBe(500);
    expect(error.code).toBe("internal_error");
  });
});

describe("RateLimitStage", () => {
  it("hands the populated context to the limiter seam", async () => {
    const seen: RequestContext[] = [];
    const stage = new RateLimitStage({
      check: (context): Promise<void> => {
        seen.push(context);
        return Promise.resolve();
      },
    });
    const context = contextOf();
    await stage.run(context);
    expect(seen).toEqual([context]);
  });
});

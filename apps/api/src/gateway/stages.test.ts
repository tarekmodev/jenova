import { subTenantId, tenantId, type AppKey, type TenantId } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryMachineKeyStore,
  MachineAuthService,
  signMachineCredential,
} from "../auth/machine-auth";
import { SessionService } from "../auth/session-service";
import { InMemorySessionStore } from "../auth/session-store";
import { ApiHttpError } from "./errors";
import {
  createRequestContext,
  requireMachineAuth,
  requireRealm,
  type RequestContext,
  type SessionPrincipal,
  type VerifiedSessionAuth,
} from "./request-context";
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
  return {
    host: KNOWN_HOST,
    authorization: null,
    requiredApp: null,
    allowedRealms: null,
    ...overrides,
  };
}

/** Real session + machine services over in-memory stores (nothing faked). */
function authFixture(): {
  stage: AuthRealmStage;
  sessions: SessionService;
  machineKeys: InMemoryMachineKeyStore;
} {
  const sessions = new SessionService(new InMemorySessionStore());
  const machineKeys = new InMemoryMachineKeyStore();
  return {
    stage: new AuthRealmStage(sessions, new MachineAuthService(machineKeys)),
    sessions,
    machineKeys,
  };
}

const AGENCY_PRINCIPAL: SessionPrincipal<"agency"> = {
  realm: "agency",
  userId: "user-1",
  tenantId: KNOWN_TENANT,
  subTenantId: subTenantId("agency-1"),
};

/** Context that already passed tenant resolution for KNOWN_HOST. */
async function tenantResolvedContext(): Promise<RequestContext> {
  const context = createRequestContext("req-1");
  await new TenantResolutionStage(directoryWithOneHost).run(context, requestInfo());
  return context;
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
    const { stage: authStage, sessions } = authFixture();
    const issued = await sessions.issue(AGENCY_PRINCIPAL);
    const seenByLimiter: RequestContext[] = [];
    const pipeline = new GatewayPipeline([
      new TenantResolutionStage(directoryWithOneHost),
      authStage,
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
      requestInfo({ authorization: `Bearer ${issued.token}`, requiredApp: "b2b" }),
    );

    expect(context.requestId).toBe("req-1");
    expect(context.tenant).toEqual({ tenantId: KNOWN_TENANT, dbName: KNOWN_DB, host: KNOWN_HOST });
    expect(context.auth).toEqual({
      state: "verified",
      realm: "agency",
      principal: AGENCY_PRINCIPAL,
      sessionTokenHash: issued.tokenHash,
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

describe("parseRealmTaggedBearer", () => {
  it("parses a realm-tagged bearer token as the UNVERIFIED intermediate", () => {
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

describe("AuthRealmStage (verification, issue #32)", () => {
  async function expect401(promise: Promise<unknown>): Promise<void> {
    const error = await errorFrom(promise);
    expect(error.getStatus()).toBe(401);
    expect(error.code).toBe("unauthorized");
  }

  it("records an anonymous context when no Authorization header is sent", async () => {
    const { stage } = authFixture();
    const context = await tenantResolvedContext();
    await stage.run(context, requestInfo());
    expect(context.auth).toEqual({ state: "anonymous" });
  });

  it("verifies a real issued session into a verified, realm-typed context", async () => {
    const { stage, sessions } = authFixture();
    const issued = await sessions.issue(AGENCY_PRINCIPAL);
    const context = await tenantResolvedContext();

    await stage.run(context, requestInfo({ authorization: `Bearer ${issued.token}` }));
    expect(context.auth).toEqual({
      state: "verified",
      realm: "agency",
      principal: AGENCY_PRINCIPAL,
      sessionTokenHash: issued.tokenHash,
    });
  });

  it("refuses a never-issued credential with the one generic 401", async () => {
    const { stage } = authFixture();
    await expect401(
      stage.run(
        await tenantResolvedContext(),
        requestInfo({ authorization: "Bearer agency.never-issued" }),
      ),
    );
  });

  it("fails closed: a PRESENT but malformed Authorization header is 401, not anonymous", async () => {
    const { stage } = authFixture();
    for (const bad of ["Bearer nosuchrealm.cred", "Bearer no-dot", "Bearer agency.", "Basic zzz"]) {
      await expect401(
        stage.run(await tenantResolvedContext(), requestInfo({ authorization: bad })),
      );
    }
  });

  it("refuses CROSS-REALM use at runtime: agency session under the corporate tag", async () => {
    const { stage, sessions } = authFixture();
    const issued = await sessions.issue(AGENCY_PRINCIPAL);
    const secret = issued.token.slice("agency.".length);
    await expect401(
      stage.run(
        await tenantResolvedContext(),
        requestInfo({ authorization: `Bearer corporate.${secret}` }),
      ),
    );
  });

  it("refuses a revoked session (revocation is immediate — no JWT window)", async () => {
    const { stage, sessions } = authFixture();
    const issued = await sessions.issue(AGENCY_PRINCIPAL);
    await sessions.revokeByHash(issued.tokenHash);
    await expect401(
      stage.run(
        await tenantResolvedContext(),
        requestInfo({ authorization: `Bearer ${issued.token}` }),
      ),
    );
  });

  it("enforces @RequiresRealm: right realm passes, other realms and anonymous get 401", async () => {
    const { stage, sessions } = authFixture();
    const issued = await sessions.issue(AGENCY_PRINCIPAL);
    const gated = { allowedRealms: ["agency"] as const };

    const okContext = await tenantResolvedContext();
    await stage.run(okContext, requestInfo({ ...gated, authorization: `Bearer ${issued.token}` }));
    expect(okContext.auth?.state).toBe("verified");

    // Anonymous on a realm-gated route: 401.
    await expect401(stage.run(await tenantResolvedContext(), requestInfo(gated)));

    // Valid session of ANOTHER realm on the gate: 401 (no token crosses realms).
    const machineGate = { allowedRealms: ["machine"] as const };
    await expect401(
      stage.run(
        await tenantResolvedContext(),
        requestInfo({ ...machineGate, authorization: `Bearer ${issued.token}` }),
      ),
    );
  });

  it("verifies machine-realm HMAC credentials via the key store", async () => {
    const { stage, machineKeys } = authFixture();
    machineKeys.putKey({
      keyId: "key-1",
      secret: "structural-shared-secret",
      tenantId: KNOWN_TENANT,
      subTenantId: null,
      revoked: false,
    });
    const timestampSeconds = Math.floor(Date.now() / 1000);
    const credential = signMachineCredential("key-1", "structural-shared-secret", timestampSeconds);

    const context = await tenantResolvedContext();
    await stage.run(context, requestInfo({ authorization: `Bearer machine.${credential}` }));
    expect(context.auth).toEqual({
      state: "verified",
      realm: "machine",
      principal: { realm: "machine", keyId: "key-1", tenantId: KNOWN_TENANT, subTenantId: null },
    });

    // A forged signature never makes it through.
    const forged = signMachineCredential("key-1", "wrong-secret", timestampSeconds);
    await expect401(
      stage.run(
        await tenantResolvedContext(),
        requestInfo({ authorization: `Bearer machine.${forged}` }),
      ),
    );
  });
});

describe("realm-boundness is typed AND runtime (requireRealm)", () => {
  const agencyAuth: VerifiedSessionAuth<"agency"> = {
    state: "verified",
    realm: "agency",
    principal: AGENCY_PRINCIPAL,
    sessionTokenHash: "hash",
  };

  it("narrows to the requested realm at runtime", () => {
    expect(requireRealm(agencyAuth, "agency").principal.userId).toBe("user-1");
  });

  it("throws the generic 401 for the wrong realm, anonymous, and null", () => {
    for (const call of [
      () => requireRealm(agencyAuth, "corporate"),
      () => requireRealm({ state: "anonymous" }, "agency"),
      () => requireRealm(null, "agency"),
      () => requireMachineAuth(agencyAuth),
    ]) {
      expect(call).toThrowError(ApiHttpError);
    }
  });

  it("cross-realm use is a COMPILE error, not just a runtime check", () => {
    const wantsCorporate = (auth: VerifiedSessionAuth<"corporate">): string =>
      auth.principal.userId;
    // @ts-expect-error an agency session is structurally NOT a corporate one
    void (() => wantsCorporate(agencyAuth));
    // @ts-expect-error an agency principal cannot claim the corporate realm
    const impossible: SessionPrincipal<"corporate"> = AGENCY_PRINCIPAL;
    void impossible;
    expect(true).toBe(true);
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

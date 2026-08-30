import { subTenantId, tenantId } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import type { InteractiveRealm, SessionPrincipal } from "../gateway/request-context";
import {
  DEFAULT_REALM_SESSION_POLICIES,
  SessionService,
  type SessionVerification,
} from "./session-service";
import { InMemorySessionStore } from "./session-store";

// Structural test identities only — they exercise the session machinery.
const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const AGENCY_SCOPE = subTenantId("agency-1");

function agencyPrincipal(userId = "user-1"): SessionPrincipal<"agency"> {
  return { realm: "agency", userId, tenantId: TENANT_A, subTenantId: AGENCY_SCOPE };
}

function platformPrincipal(userId = "staff-1"): SessionPrincipal<"platform"> {
  return { realm: "platform", userId, tenantId: null, subTenantId: null };
}

/** Service with a controllable clock starting at a fixed instant. */
function serviceWithClock(startMs = 1_000_000): {
  service: SessionService;
  store: InMemorySessionStore;
  advance: (ms: number) => void;
} {
  let now = startMs;
  const store = new InMemorySessionStore();
  const service = new SessionService(store, { clock: () => now });
  return {
    service,
    store,
    advance: (ms) => {
      now += ms;
    },
  };
}

function credentialOf(token: string): { realm: InteractiveRealm; credential: string } {
  const dot = token.indexOf(".");
  return {
    realm: token.slice(0, dot) as InteractiveRealm,
    credential: token.slice(dot + 1),
  };
}

function expectRejection(result: SessionVerification, reason: string): void {
  expect(result).toEqual({ ok: false, reason });
}

describe("SessionService.issue", () => {
  it("returns a realm-tagged token whose stored form is ONLY the hash", async () => {
    const { service, store } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());

    expect(issued.token.startsWith("agency.")).toBe(true);
    expect(issued.realm).toBe("agency");

    const record = await store.get(issued.tokenHash);
    expect(record).not.toBeNull();
    // The secret itself appears NOWHERE in the stored record.
    const secret = issued.token.slice("agency.".length);
    expect(JSON.stringify(record)).not.toContain(secret);
  });

  it("applies the realm's TTL policy", async () => {
    const { service } = serviceWithClock(1_000_000);
    const issued = await service.issue(agencyPrincipal());
    expect(issued.expiresAtMs).toBe(1_000_000 + DEFAULT_REALM_SESSION_POLICIES.agency.ttlMs);
  });

  it("refuses a platform principal WITH a tenant, and a tenant realm WITHOUT one", async () => {
    const { service } = serviceWithClock();
    await expect(
      service.issue({ realm: "platform", userId: "s", tenantId: TENANT_A, subTenantId: null }),
    ).rejects.toThrowError(/above tenancy/);
    await expect(
      service.issue({ realm: "consumer", userId: "c", tenantId: null, subTenantId: null }),
    ).rejects.toThrowError(/tenant-scoped/);
  });
});

describe("SessionService.verifySession", () => {
  it("round-trips: issued token verifies into a realm-typed AuthContext", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { realm, credential } = credentialOf(issued.token);

    const result = await service.verifySession(realm, credential, TENANT_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth.state).toBe("verified");
      expect(result.auth.realm).toBe("agency");
      expect(result.auth.principal).toEqual(agencyPrincipal());
      expect(result.auth.sessionTokenHash).toBe(issued.tokenHash);
    }
  });

  it("rejects an unknown credential", async () => {
    const { service } = serviceWithClock();
    expectRejection(
      await service.verifySession("agency", "never-issued-credential", TENANT_A),
      "unknown_token",
    );
  });

  it("rejects empty or whitespace-padded credentials as malformed", async () => {
    const { service } = serviceWithClock();
    expectRejection(await service.verifySession("agency", "", TENANT_A), "malformed");
    expectRejection(await service.verifySession("agency", " padded ", TENANT_A), "malformed");
  });

  it("REJECTS cross-realm use: a valid agency session presented under another realm tag", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);

    for (const wrongRealm of ["tenant_staff", "corporate", "consumer", "platform"] as const) {
      expectRejection(
        await service.verifySession(wrongRealm, credential, TENANT_A),
        "realm_mismatch",
      );
    }
    // …and the session is still alive for its OWN realm.
    expect((await service.verifySession("agency", credential, TENANT_A)).ok).toBe(true);
  });

  it("REJECTS cross-tenant use: tenant A's session on tenant B's host", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);

    expectRejection(await service.verifySession("agency", credential, TENANT_B), "tenant_mismatch");
    expectRejection(await service.verifySession("agency", credential, null), "tenant_mismatch");
  });

  it("lets platform sessions (above tenancy) verify on any resolved tenant", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(platformPrincipal());
    const { credential } = credentialOf(issued.token);

    expect((await service.verifySession("platform", credential, TENANT_A)).ok).toBe(true);
    expect((await service.verifySession("platform", credential, TENANT_B)).ok).toBe(true);
  });

  it("expires at absolute TTL and DELETES the record", async () => {
    const { service, store, advance } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);

    advance(DEFAULT_REALM_SESSION_POLICIES.agency.ttlMs);
    expectRejection(await service.verifySession("agency", credential, TENANT_A), "expired");
    expect(await store.get(issued.tokenHash)).toBeNull();
  });

  it("dies after the idle window with no activity", async () => {
    const { service, advance } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);

    advance(DEFAULT_REALM_SESSION_POLICIES.agency.idleTimeoutMs + 1);
    expectRejection(await service.verifySession("agency", credential, TENANT_A), "idle_timeout");
  });

  it("activity slides the idle window (touch on every successful verify)", async () => {
    const { service, advance } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);
    const idle = DEFAULT_REALM_SESSION_POLICIES.agency.idleTimeoutMs;

    // Keep touching just inside the window — stays alive well past one window.
    for (let i = 0; i < 3; i++) {
      advance(idle - 1);
      expect((await service.verifySession("agency", credential, TENANT_A)).ok).toBe(true);
    }
  });
});

describe("SessionService.rotate", () => {
  it("rotation kills the old credential and issues a working new one", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);

    const rotated = await service.rotate("agency", credential, TENANT_A);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    // Old token: dead. New token: verifies, and is a different secret.
    expectRejection(await service.verifySession("agency", credential, TENANT_A), "unknown_token");
    expect(rotated.session.token).not.toBe(issued.token);
    const next = credentialOf(rotated.session.token);
    expect((await service.verifySession("agency", next.credential, TENANT_A)).ok).toBe(true);
  });

  it("rotation on privilege change carries the NEW principal", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal("user-1"));
    const { credential } = credentialOf(issued.token);
    const elevated: SessionPrincipal<"agency"> = {
      ...agencyPrincipal("user-1"),
      subTenantId: subTenantId("agency-2"),
    };

    const rotated = await service.rotate("agency", credential, TENANT_A, elevated);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    const next = credentialOf(rotated.session.token);
    const verified = await service.verifySession("agency", next.credential, TENANT_A);
    expect(verified.ok && verified.auth.principal).toEqual(elevated);
  });

  it("refuses to rotate a credential that does not verify", async () => {
    const { service } = serviceWithClock();
    const rotated = await service.rotate("agency", "bogus", TENANT_A);
    expect(rotated).toEqual({ ok: false, reason: "unknown_token" });
  });
});

describe("SessionService revocation", () => {
  it("revokes a single session", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);

    expect(await service.revoke("agency", credential)).toBe(true);
    expectRejection(await service.verifySession("agency", credential, TENANT_A), "unknown_token");
    expect(await service.revoke("agency", credential)).toBe(false);
  });

  it("revocation is realm-checked too", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    const { credential } = credentialOf(issued.token);

    expect(await service.revoke("consumer", credential)).toBe(false);
    expect((await service.verifySession("agency", credential, TENANT_A)).ok).toBe(true);
  });

  it("revokes by hash (admin tooling — no secret in hand)", async () => {
    const { service } = serviceWithClock();
    const issued = await service.issue(agencyPrincipal());
    expect(await service.revokeByHash(issued.tokenHash)).toBe(true);
  });

  it("revokeAllForUser kills every session of that user — and no one else's", async () => {
    const { service } = serviceWithClock();
    const mine1 = await service.issue(agencyPrincipal("user-1"));
    const mine2 = await service.issue(agencyPrincipal("user-1"));
    const theirs = await service.issue(agencyPrincipal("user-2"));

    expect(await service.revokeAllForUser("agency", "user-1", TENANT_A)).toBe(2);
    for (const dead of [mine1, mine2]) {
      const { credential } = credentialOf(dead.token);
      expectRejection(await service.verifySession("agency", credential, TENANT_A), "unknown_token");
    }
    const alive = credentialOf(theirs.token);
    expect((await service.verifySession("agency", alive.credential, TENANT_A)).ok).toBe(true);
  });
});

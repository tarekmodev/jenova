import { subTenantId, tenantId } from "@jenova/domain";
import { describe, expect, it } from "vitest";
import {
  InMemoryMachineKeyStore,
  MACHINE_TIMESTAMP_SKEW_MS,
  MachineAuthService,
  machineStringToSign,
  signMachineCredential,
  type MachineKeyRecord,
} from "./machine-auth";

// Structural test identities only — they exercise the HMAC machinery.
const TENANT_A = tenantId("tenant-a");
const TENANT_B = tenantId("tenant-b");
const NOW_MS = 1_700_000_000_000;
const NOW_SECONDS = NOW_MS / 1000;

const KEY: MachineKeyRecord = {
  keyId: "key-1",
  secret: "structural-shared-secret-for-hmac-tests",
  tenantId: TENANT_A,
  subTenantId: subTenantId("agency-1"),
  revoked: false,
};

function serviceWith(...keys: MachineKeyRecord[]): MachineAuthService {
  const store = new InMemoryMachineKeyStore();
  for (const key of keys) store.putKey(key);
  return new MachineAuthService(store, { clock: () => NOW_MS });
}

describe("machineStringToSign", () => {
  it("binds realm tag, key id and timestamp", () => {
    expect(machineStringToSign("key-1", 42)).toBe("machine.key-1.42");
  });
});

describe("MachineAuthService.verifyMachineCredential", () => {
  it("accepts a freshly signed credential and yields the machine principal", async () => {
    const service = serviceWith(KEY);
    const credential = signMachineCredential(KEY.keyId, KEY.secret, NOW_SECONDS);

    const result = await service.verifyMachineCredential(credential, TENANT_A);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auth).toEqual({
        state: "verified",
        realm: "machine",
        principal: {
          realm: "machine",
          keyId: KEY.keyId,
          tenantId: TENANT_A,
          subTenantId: KEY.subTenantId,
        },
      });
    }
  });

  it("rejects a signature made with the wrong secret", async () => {
    const service = serviceWith(KEY);
    const forged = signMachineCredential(KEY.keyId, "not-the-secret", NOW_SECONDS);
    expect(await service.verifyMachineCredential(forged, TENANT_A)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered timestamp (signature no longer covers it)", async () => {
    const service = serviceWith(KEY);
    const credential = signMachineCredential(KEY.keyId, KEY.secret, NOW_SECONDS);
    const parts = credential.split(".");
    const tampered = `${parts[0]}.${String(NOW_SECONDS + 30)}.${parts[2]}`;
    expect(await service.verifyMachineCredential(tampered, TENANT_A)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects timestamps outside the skew window in either direction", async () => {
    const service = serviceWith(KEY);
    const skewSeconds = MACHINE_TIMESTAMP_SKEW_MS / 1000;
    for (const staleAt of [NOW_SECONDS - skewSeconds - 1, NOW_SECONDS + skewSeconds + 1]) {
      const credential = signMachineCredential(KEY.keyId, KEY.secret, staleAt);
      expect(await service.verifyMachineCredential(credential, TENANT_A)).toEqual({
        ok: false,
        reason: "stale_timestamp",
      });
    }
  });

  it("rejects unknown and revoked keys", async () => {
    const service = serviceWith({ ...KEY, keyId: "key-2", revoked: true });
    expect(
      await service.verifyMachineCredential(
        signMachineCredential("key-1", KEY.secret, NOW_SECONDS),
        TENANT_A,
      ),
    ).toEqual({ ok: false, reason: "unknown_key" });
    expect(
      await service.verifyMachineCredential(
        signMachineCredential("key-2", KEY.secret, NOW_SECONDS),
        TENANT_A,
      ),
    ).toEqual({ ok: false, reason: "revoked_key" });
  });

  it("rejects a valid credential on the WRONG tenant's host — and with no tenant at all", async () => {
    const service = serviceWith(KEY);
    const credential = signMachineCredential(KEY.keyId, KEY.secret, NOW_SECONDS);
    expect(await service.verifyMachineCredential(credential, TENANT_B)).toEqual({
      ok: false,
      reason: "tenant_mismatch",
    });
    expect(await service.verifyMachineCredential(credential, null)).toEqual({
      ok: false,
      reason: "tenant_mismatch",
    });
  });

  it("rejects malformed credential shapes", async () => {
    const service = serviceWith(KEY);
    for (const malformed of ["", "only-one", "two.parts", "a.b.c.d", "key-1.notanumber.sig", "key-1..sig", ".123.sig", "key-1.123."]) {
      expect(await service.verifyMachineCredential(malformed, TENANT_A)).toEqual({
        ok: false,
        reason: "malformed",
      });
    }
  });
});

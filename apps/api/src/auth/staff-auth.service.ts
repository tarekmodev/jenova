/**
 * Tenant-staff login / TOTP lifecycle (M2 dashboard, issue #89).
 *
 * MONEY-PATH ADJACENT — human review required. Deliberately THIN over the
 * M0 primitives: argon2id verification (password.ts), TOTP with replay
 * lockout (totp.ts), realm-bound opaque sessions (session-service.ts). No
 * new crypto lives here; the only added mechanics are orchestration and
 * the sealed-at-rest TOTP secret (tenancy/secret-box).
 *
 * Failure semantics: unknown email, disabled account and wrong password
 * are ONE indistinguishable `invalid_credentials` (and the unknown-email
 * path still burns an argon2 verification so timing does not reveal
 * account existence). TOTP outcomes are only distinguishable AFTER the
 * password verified — a caller who has proven the password may know the
 * second factor is pending.
 */

import type { TenantId } from "@jenova/domain";
import type { SecretBox } from "../tenancy/secret-box";
import type { VerifiedSessionAuth } from "../gateway/request-context";
import { hashPassword, passwordNeedsRehash, verifyPassword } from "./password";
import { createTotpEnrollment, type TotpVerifier } from "./totp";
import type { IssuedSession, SessionService } from "./session-service";
import type { StaffPolicyRecord, StaffUserRecord, StaffUserStore } from "./staff-users";

/** Nest injection token for the process-wide {@link StaffAuthService}. */
export const STAFF_AUTH_SERVICE = Symbol("jenova.api.staffAuthService");

/** otpauth issuer label shown in authenticator apps. */
const TOTP_ISSUER = "Jenova";

export interface StaffProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: string;
  readonly status: string;
  readonly totpEnrolled: boolean;
}

export function staffProfileOf(user: StaffUserRecord): StaffProfile {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    totpEnrolled: user.totpSecretEncrypted !== null,
  };
}

export type StaffLoginResult =
  | {
      readonly ok: true;
      readonly session: IssuedSession;
      readonly user: StaffProfile;
      /** Tenant policy demands TOTP and this user has not enrolled yet. */
      readonly totpEnrollmentRequired: boolean;
    }
  | { readonly ok: false; readonly reason: "invalid_credentials" | "totp_required" | "totp_invalid" };

export type TotpActivationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "no_pending_enrollment" | "totp_invalid" };

export class StaffAuthService {
  constructor(
    private readonly store: StaffUserStore,
    private readonly sessions: SessionService,
    private readonly totp: TotpVerifier,
    private readonly secrets: SecretBox,
  ) {}

  async login(
    tenant: TenantId,
    input: {
      readonly email: string;
      readonly password: string;
      readonly totpCode?: string | undefined;
    },
  ): Promise<StaffLoginResult> {
    const user = await this.store.findByEmail(tenant, input.email);
    if (user === null || user.status !== "active") {
      // Burn comparable work so a missing account costs what a wrong
      // password costs — no existence oracle through timing.
      await hashPassword(input.password);
      return { ok: false, reason: "invalid_credentials" };
    }
    if (!(await verifyPassword(user.passwordHash, input.password))) {
      return { ok: false, reason: "invalid_credentials" };
    }

    const enrolled = user.totpSecretEncrypted !== null && user.totpSecretKeyId !== null;
    if (user.totpSecretEncrypted !== null && user.totpSecretKeyId !== null) {
      if (input.totpCode === undefined || input.totpCode === "") {
        return { ok: false, reason: "totp_required" };
      }
      const secret = this.secrets.open(user.totpSecretEncrypted, user.totpSecretKeyId);
      const verdict = await this.totp.verify(totpSubjectKey(tenant, user.id), secret, input.totpCode);
      if (!verdict.accepted) {
        return { ok: false, reason: "totp_invalid" };
      }
    }

    if (passwordNeedsRehash(user.passwordHash)) {
      // Upgrade-on-login: parameters travel with the PHC string.
      await this.store.updatePasswordHash(tenant, user.id, await hashPassword(input.password));
    }

    const policy = await this.store.getPolicy(tenant);
    const session = await this.sessions.issue({
      realm: "tenant_staff",
      userId: user.id,
      tenantId: tenant,
      subTenantId: null,
    });
    return {
      ok: true,
      session,
      user: staffProfileOf(user),
      totpEnrollmentRequired: policy.enforceTotp && !enrolled,
    };
  }

  /** Revoke exactly the presented session (safe handle: its hash). */
  logout(auth: VerifiedSessionAuth<"tenant_staff">): Promise<boolean> {
    return this.sessions.revokeByHash(auth.sessionTokenHash);
  }

  async me(
    tenant: TenantId,
    userId: string,
  ): Promise<{ readonly user: StaffProfile; readonly policy: StaffPolicyRecord } | null> {
    const user = await this.store.findById(tenant, userId);
    if (user === null) return null;
    return { user: staffProfileOf(user), policy: await this.store.getPolicy(tenant) };
  }

  /**
   * Begin (or restart) TOTP enrollment: a fresh secret is sealed into the
   * pending slot and shown to the user ONCE (secret + otpauth URI for the
   * dashboard's QR renderer). Nothing changes for login until activation
   * proves the authenticator with a valid code.
   */
  async beginTotpEnrollment(
    tenant: TenantId,
    userId: string,
  ): Promise<{ readonly secret: string; readonly otpauthUri: string } | null> {
    const user = await this.store.findById(tenant, userId);
    if (user === null || user.status !== "active") return null;
    const enrollment = createTotpEnrollment({ issuer: TOTP_ISSUER, accountName: user.email });
    await this.store.setPendingTotp(
      tenant,
      userId,
      this.secrets.seal(enrollment.secret),
      this.secrets.keyId,
    );
    return { secret: enrollment.secret, otpauthUri: enrollment.otpauthUri };
  }

  /** Prove the authenticator holds the pending secret, then promote it. */
  async activateTotp(
    tenant: TenantId,
    userId: string,
    code: string,
  ): Promise<TotpActivationResult> {
    const user = await this.store.findById(tenant, userId);
    if (
      user === null ||
      user.totpPendingSecretEncrypted === null ||
      user.totpPendingSecretKeyId === null
    ) {
      return { ok: false, reason: "no_pending_enrollment" };
    }
    const secret = this.secrets.open(user.totpPendingSecretEncrypted, user.totpPendingSecretKeyId);
    const verdict = await this.totp.verify(totpSubjectKey(tenant, userId), secret, code);
    if (!verdict.accepted) {
      return { ok: false, reason: "totp_invalid" };
    }
    const activated = await this.store.activateTotp(tenant, userId, new Date());
    if (!activated) {
      return { ok: false, reason: "no_pending_enrollment" };
    }
    return { ok: true };
  }
}

/** Replay-lockout scope: one enrolled credential (totp.ts contract). */
function totpSubjectKey(tenant: TenantId, userId: string): string {
  return `${tenant}:tenant_staff:${userId}`;
}

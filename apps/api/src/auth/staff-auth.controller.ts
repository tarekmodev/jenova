/**
 * Tenant-staff auth endpoints (M2 dashboard, issue #89) — the Internal
 * Dashboard's login/logout/TOTP surface. MONEY-PATH ADJACENT — human
 * review required. Thin controllers over StaffAuthService: parse, gate,
 * translate — nothing clever here.
 *
 * The login rejection surface is deliberately narrow: bad email, unknown
 * account, disabled account and wrong password are all ONE generic 401
 * `unauthorized`. `totp_required` / `totp_invalid` become visible only
 * AFTER the password verified (see staff-auth.service.ts).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AllowAnonymous, RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
  type VerifiedSessionAuth,
} from "../gateway/request-context";
import { STAFF_AUTH_SERVICE, type StaffAuthService } from "./staff-auth.service";

const loginBody = z.object({
  email: z.string().min(3).max(320),
  password: z.string().min(1).max(1_024),
  totpCode: z.string().regex(/^\d{6,8}$/).optional(),
});

const totpActivateBody = z.object({
  code: z.string().regex(/^\d{6,8}$/),
});

@ApiTags("staff-auth")
@Controller("staff/auth")
export class StaffAuthController {
  constructor(@Inject(STAFF_AUTH_SERVICE) private readonly staffAuth: StaffAuthService) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  @ApiOperation({
    summary: "Tenant-staff login (email + argon2id password, TOTP when enrolled)",
    description:
      "Verifies credentials against the tenant's own staff user store and issues a realm-bound " +
      "tenant_staff session token (opaque, revocable). When the user has TOTP enrolled the call " +
      "must carry totpCode; 401 totp_required signals the second factor is missing, 401 " +
      "totp_invalid a wrong/replayed code — both only after the password verified. Every other " +
      "failure is the one generic 401.",
  })
  @ApiResponse({ status: 200, description: "Session issued — token returned ONCE, never again." })
  @ApiResponse({ status: 401, description: "unauthorized | totp_required | totp_invalid." })
  async login(
    @Req() request: RequestContextCarrier,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    const parsed = loginBody.safeParse(rawBody);
    if (!parsed.success) {
      // Malformed login input is indistinguishable from a failed login —
      // no shape oracle on an anonymous route.
      throw ApiHttpError.unauthorized();
    }
    const result = await this.staffAuth.login(tenant.tenantId, parsed.data);
    if (!result.ok) {
      if (result.reason === "invalid_credentials") {
        throw ApiHttpError.unauthorized();
      }
      throw new ApiHttpError(result.reason, "a valid TOTP code is required", HttpStatus.UNAUTHORIZED);
    }
    return {
      token: result.session.token,
      expiresAt: new Date(result.session.expiresAtMs).toISOString(),
      user: result.user,
      totpEnrollmentRequired: result.totpEnrollmentRequired,
    };
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresRealm("tenant_staff")
  @ApiOperation({ summary: "Revoke the presented tenant-staff session" })
  async logout(@Req() request: RequestContextCarrier): Promise<void> {
    const { auth } = this.scope(request);
    await this.staffAuth.logout(auth);
  }

  @Get("me")
  @RequiresRealm("tenant_staff")
  @ApiOperation({ summary: "Profile + tenant security policy for the session's user" })
  async me(@Req() request: RequestContextCarrier): Promise<Record<string, unknown>> {
    const { tenant, auth } = this.scope(request);
    const me = await this.staffAuth.me(tenant.tenantId, auth.principal.userId);
    if (me === null) {
      // The user behind a live session vanished — treat as unauthenticated.
      throw ApiHttpError.unauthorized();
    }
    return {
      user: me.user,
      policy: me.policy,
      totpEnrollmentRequired: me.policy.enforceTotp && !me.user.totpEnrolled,
    };
  }

  @Post("totp/enroll")
  @HttpCode(HttpStatus.OK)
  @RequiresRealm("tenant_staff")
  @ApiOperation({
    summary: "Begin TOTP enrollment",
    description:
      "Generates a fresh RFC 6238 secret, seals it at rest, and returns secret + otpauth:// URI " +
      "ONCE for the dashboard's QR renderer. Login is unchanged until activation proves the " +
      "authenticator with a valid code.",
  })
  async beginTotpEnrollment(
    @Req() request: RequestContextCarrier,
  ): Promise<Record<string, unknown>> {
    const { tenant, auth } = this.scope(request);
    const enrollment = await this.staffAuth.beginTotpEnrollment(
      tenant.tenantId,
      auth.principal.userId,
    );
    if (enrollment === null) {
      throw ApiHttpError.unauthorized();
    }
    return enrollment;
  }

  @Post("totp/activate")
  @HttpCode(HttpStatus.OK)
  @RequiresRealm("tenant_staff")
  @ApiOperation({ summary: "Prove the pending TOTP enrollment and switch it on" })
  async activateTotp(
    @Req() request: RequestContextCarrier,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const { tenant, auth } = this.scope(request);
    const parsed = totpActivateBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError("bad_request", "body must be { code: string }", HttpStatus.BAD_REQUEST);
    }
    const result = await this.staffAuth.activateTotp(
      tenant.tenantId,
      auth.principal.userId,
      parsed.data.code,
    );
    if (!result.ok) {
      throw new ApiHttpError(
        result.reason,
        result.reason === "totp_invalid"
          ? "the code did not match the pending enrollment"
          : "no TOTP enrollment is pending",
        HttpStatus.BAD_REQUEST,
      );
    }
    return { ok: true };
  }

  private tenant(request: RequestContextCarrier): ResolvedTenant {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    return context.tenant;
  }

  private scope(request: RequestContextCarrier): {
    tenant: ResolvedTenant;
    auth: VerifiedSessionAuth<"tenant_staff">;
  } {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    return { tenant: context.tenant, auth: requireRealm(context.auth, "tenant_staff") };
  }
}

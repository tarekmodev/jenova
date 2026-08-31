/**
 * Agency-realm session endpoints for the Agent Portal (M2 issue #95), thin
 * bindings over the M0 auth primitives (SessionService, argon2id password
 * verify). AGENCY-NAMED ON PURPOSE: the dashboard workstream adds the
 * tenant_staff twin in its own files — realms never share endpoints, user
 * stores, or sessions (docs/08-security.md).
 *
 * Login is @AllowAnonymous but still tenant-scoped: the gateway resolved the
 * tenant BEFORE this handler, so the lookup runs against exactly that
 * tenant's user store. Every refusal is the same generic 401 — unknown
 * email, wrong password, unset credential, suspended user or agency are
 * indistinguishable (no oracle), and a dummy argon2id verification keeps the
 * unknown-email path on the same clock as the wrong-password path.
 *
 * RATE LIMITING: the gateway's rate-limit stage is still the M0 no-op, so
 * this password endpoint is unthrottled (and each guess costs an argon2id
 * verify). Per-realm rate limiting + lockout are tracked in issue #109 and
 * MUST land before any internet-facing exposure (docs/08-security.md).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { tenants, type ControlPlaneClient } from "@jenova/db";
import type { TenantId } from "@jenova/domain";
import { AllowAnonymous, RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
} from "../gateway/request-context";
import { CONTROL_PLANE_CLIENT } from "../tenancy/tenant-db.module";
import { AGENCY_USER_DIRECTORY, type AgencyPortalUser, type AgencyUserDirectory } from "./agency-users";
import { hashPassword, verifyPassword } from "./password";
import { SESSION_SERVICE, type SessionService } from "./session-service";

const loginBody = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(1_024),
});

interface AgencySessionPayload {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
    readonly role: string;
  };
  readonly agency: {
    readonly id: string;
    readonly name: string;
    readonly defaultNationality: string | null;
    readonly allowedCurrencies: readonly string[];
  };
  readonly tenant: {
    readonly name: string;
    readonly branding: Readonly<Record<string, unknown>>;
  };
}

function isActive(user: AgencyPortalUser): boolean {
  return user.status === "active" && user.agency.status === "active";
}

@ApiTags("auth")
@Controller("auth/agency")
export class AgencyAuthController {
  /** Lazily minted argon2id hash of random bytes — the timing-equalizer. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
    @Inject(AGENCY_USER_DIRECTORY) private readonly users: AgencyUserDirectory,
    @Inject(CONTROL_PLANE_CLIENT) private readonly controlPlane: ControlPlaneClient,
  ) {}

  @Post("login")
  @HttpCode(HttpStatus.OK)
  @AllowAnonymous()
  @ApiOperation({
    summary: "Agent Portal login (agency realm)",
    description:
      "Verifies the agency user's password (argon2id) against THIS tenant's user store and " +
      "issues a realm-bound session. The returned token is the full bearer credential " +
      "(`agency.<secret>`) — send it as `Authorization: Bearer <token>`. Every failure is the " +
      "same generic 401.",
  })
  @ApiResponse({ status: 200, description: "Session issued: token, expiry, user/agency/tenant context." })
  @ApiResponse({ status: 401, description: "Invalid credentials (uniform for every failure mode)." })
  async login(@Req() request: RequestContextCarrier, @Body() body: unknown) {
    const tenant = this.tenantOf(request);
    const parsed = loginBody.safeParse(body);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { email, password }",
        HttpStatus.BAD_REQUEST,
      );
    }

    const user = await this.users.findByEmail(tenant.tenantId, parsed.data.email);
    const verified = await this.verifyOnLevelClock(user, parsed.data.password);
    if (user === null || !verified || !isActive(user)) {
      throw ApiHttpError.unauthorized();
    }

    const session = await this.sessions.issue({
      realm: "agency",
      userId: user.userId,
      tenantId: tenant.tenantId,
      subTenantId: user.agency.id,
    });
    return {
      token: session.token,
      expiresAt: new Date(session.expiresAtMs).toISOString(),
      ...(await this.payload(tenant.tenantId, user)),
    };
  }

  @Get("session")
  @RequiresRealm("agency")
  @ApiOperation({ summary: "Current agency session context (user, agency, tenant branding)" })
  async session(@Req() request: RequestContextCarrier) {
    const tenant = this.tenantOf(request);
    const auth = requireRealm(getRequestContext(request)?.auth ?? null, "agency");
    const user = await this.users.findById(tenant.tenantId, auth.principal.userId);
    if (user === null || !isActive(user)) {
      // The user or agency was deactivated after the session was minted:
      // kill the session and refuse — same generic 401.
      await this.sessions.revokeByHash(auth.sessionTokenHash);
      throw ApiHttpError.unauthorized();
    }
    return this.payload(tenant.tenantId, user);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequiresRealm("agency")
  @ApiOperation({ summary: "Revoke the presented agency session" })
  async logout(@Req() request: RequestContextCarrier): Promise<void> {
    const auth = requireRealm(getRequestContext(request)?.auth ?? null, "agency");
    await this.sessions.revokeByHash(auth.sessionTokenHash);
  }

  private tenantOf(request: RequestContextCarrier): ResolvedTenant {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    return context.tenant;
  }

  /**
   * Constant-shape verification: the unknown-email and credential-not-set
   * paths still run one argon2id verification (against a throwaway hash),
   * so response timing does not disclose whether the email exists.
   */
  private async verifyOnLevelClock(
    user: AgencyPortalUser | null,
    password: string,
  ): Promise<boolean> {
    const hash = user?.passwordHash ?? null;
    if (hash !== null) {
      return verifyPassword(hash, password);
    }
    this.dummyHash ??= hashPassword(`dummy.${Math.random().toString(36).slice(2)}`);
    await verifyPassword(await this.dummyHash, password);
    return false;
  }

  private async payload(tenantId: TenantId, user: AgencyPortalUser): Promise<AgencySessionPayload> {
    const [tenantRow] = await this.controlPlane.db
      .select({ name: tenants.name, branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return {
      user: {
        id: user.userId,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      agency: {
        id: user.agency.id,
        name: user.agency.name,
        defaultNationality: user.agency.defaultNationality,
        allowedCurrencies: user.agency.allowedCurrencies,
      },
      tenant: {
        name: tenantRow?.name ?? "",
        branding: tenantRow?.branding ?? {},
      },
    };
  }
}

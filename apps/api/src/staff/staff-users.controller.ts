/**
 * Settings → Users & roles (issue #91): list/invite/deactivate tenant
 * staff, role assignment, and the tenant-wide enforce-TOTP policy.
 *
 * Invite-lite: creating a user mints a random initial password returned
 * ONCE in the response (email delivery arrives with Documents v1's mail
 * plumbing — flagged in the PR). Deactivation revokes every live session
 * of the user immediately.
 *
 * M2 authorization note: every tenant_staff session may manage settings;
 * role-based restriction (admin-only) is stored now and enforced when the
 * role model grows teeth — flagged in the PR.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { generateOpaqueSecret } from "../auth/tokens";
import { hashPassword } from "../auth/password";
import { SESSION_SERVICE, type SessionService } from "../auth/session-service";
import {
  STAFF_ROLES,
  STAFF_USER_STORE,
  staffProfileRowOf,
  type StaffUserStore,
} from "../auth/staff-users";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
  type VerifiedSessionAuth,
} from "../gateway/request-context";

const inviteBody = z.object({
  email: z.string().email().max(320),
  displayName: z.string().min(1).max(120),
  role: z.enum(STAFF_ROLES),
});

const patchBody = z.object({
  displayName: z.string().min(1).max(120).optional(),
  role: z.enum(STAFF_ROLES).optional(),
});

const policyBody = z.object({
  enforceTotp: z.boolean(),
});

const idParam = z.string().min(1).max(64);

@ApiTags("staff-settings")
@Controller("staff/users")
@RequiresRealm("tenant_staff")
export class StaffUsersController {
  constructor(
    @Inject(STAFF_USER_STORE) private readonly store: StaffUserStore,
    @Inject(SESSION_SERVICE) private readonly sessions: SessionService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List tenant staff users" })
  async list(@Req() request: RequestContextCarrier): Promise<Record<string, unknown>> {
    const { tenant } = this.scope(request);
    const users = await this.store.list(tenant.tenantId);
    return { users: users.map(staffProfileRowOf) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Invite a staff user",
    description:
      "Creates the account with a random initial password, returned ONCE in this response and " +
      "never retrievable again. The invitee signs in with it and should enroll TOTP.",
  })
  async invite(
    @Req() request: RequestContextCarrier,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const { tenant } = this.scope(request);
    const parsed = inviteBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { email, displayName, role }",
        HttpStatus.BAD_REQUEST,
      );
    }
    const existing = await this.store.findByEmail(tenant.tenantId, parsed.data.email);
    if (existing !== null) {
      throw new ApiHttpError("email_taken", "a staff user with this email exists", HttpStatus.CONFLICT);
    }
    // 12 base64url chars ≈ 72 bits — a one-time bootstrap credential the
    // invitee replaces; minted by the same CSPRNG as session secrets.
    const initialPassword = generateOpaqueSecret(9);
    const user = await this.store.create(tenant.tenantId, {
      email: parsed.data.email,
      displayName: parsed.data.displayName,
      role: parsed.data.role,
      passwordHash: await hashPassword(initialPassword),
    });
    return { user: staffProfileRowOf(user), initialPassword };
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a staff user's display name / role" })
  async update(
    @Req() request: RequestContextCarrier,
    @Param("id") rawId: string,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const { tenant } = this.scope(request);
    const id = this.parseId(rawId);
    const parsed = patchBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError("bad_request", "body must be { displayName?, role? }", HttpStatus.BAD_REQUEST);
    }
    const updated = await this.store.updateProfile(tenant.tenantId, id, parsed.data);
    if (updated === null) {
      throw new ApiHttpError("user_not_found", "unknown staff user", HttpStatus.NOT_FOUND);
    }
    return { user: staffProfileRowOf(updated) };
  }

  @Post(":id/deactivate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Deactivate a staff user and revoke every live session",
  })
  async deactivate(
    @Req() request: RequestContextCarrier,
    @Param("id") rawId: string,
  ): Promise<Record<string, unknown>> {
    const { tenant, auth } = this.scope(request);
    const id = this.parseId(rawId);
    if (id === auth.principal.userId) {
      // Locking yourself out of the tenant is never one click.
      throw new ApiHttpError("cannot_deactivate_self", "you cannot deactivate your own account", HttpStatus.CONFLICT);
    }
    const updated = await this.store.setStatus(tenant.tenantId, id, "disabled");
    if (updated === null) {
      throw new ApiHttpError("user_not_found", "unknown staff user", HttpStatus.NOT_FOUND);
    }
    await this.sessions.revokeAllForUser("tenant_staff", id, tenant.tenantId);
    return { user: staffProfileRowOf(updated) };
  }

  @Post(":id/activate")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Re-activate a deactivated staff user" })
  async activate(
    @Req() request: RequestContextCarrier,
    @Param("id") rawId: string,
  ): Promise<Record<string, unknown>> {
    const { tenant } = this.scope(request);
    const id = this.parseId(rawId);
    const updated = await this.store.setStatus(tenant.tenantId, id, "active");
    if (updated === null) {
      throw new ApiHttpError("user_not_found", "unknown staff user", HttpStatus.NOT_FOUND);
    }
    return { user: staffProfileRowOf(updated) };
  }

  private parseId(raw: string): string {
    const parsed = idParam.safeParse(raw);
    if (!parsed.success) {
      throw new ApiHttpError("user_not_found", "unknown staff user", HttpStatus.NOT_FOUND);
    }
    return parsed.data;
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

@ApiTags("staff-settings")
@Controller("staff/policy")
@RequiresRealm("tenant_staff")
export class StaffPolicyController {
  constructor(@Inject(STAFF_USER_STORE) private readonly store: StaffUserStore) {}

  @Get()
  @ApiOperation({ summary: "Tenant staff security policy" })
  async get(@Req() request: RequestContextCarrier): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    return { policy: await this.store.getPolicy(tenant.tenantId) };
  }

  @Put()
  @ApiOperation({ summary: "Set the enforce-TOTP switch (docs/08 tenant policy)" })
  async put(
    @Req() request: RequestContextCarrier,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    const parsed = policyBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError("bad_request", "body must be { enforceTotp: boolean }", HttpStatus.BAD_REQUEST);
    }
    return { policy: await this.store.setPolicy(tenant.tenantId, parsed.data) };
  }

  private tenant(request: RequestContextCarrier): ResolvedTenant {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    requireRealm(context.auth, "tenant_staff");
    return context.tenant;
  }
}

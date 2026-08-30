/**
 * GET /me/entitlements (M2 dashboard, issue #90) — which installable apps
 * this tenant has (CLAUDE.md rule 3: apps are entitlement flags). The
 * dashboard builds its whole navigation from this one read; uninstalled
 * apps are absent from nav AND refused at their routes.
 */

import { Controller, Get, Inject, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { APP_KEYS } from "@jenova/domain";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import { getRequestContext, requireRealm, type RequestContextCarrier } from "../gateway/request-context";
import type { ControlPlaneEntitlementSource } from "../tenancy/control-plane-directory";

/** Injection token for the control-plane entitlement reader used here. */
export const ENTITLEMENT_READER = Symbol("jenova.api.entitlementReader");

@ApiTags("me")
@Controller("me")
export class MeController {
  constructor(
    @Inject(ENTITLEMENT_READER) private readonly entitlements: ControlPlaneEntitlementSource,
  ) {}

  @Get("entitlements")
  @RequiresRealm("tenant_staff")
  @ApiOperation({
    summary: "Installed apps for the session's tenant",
    description:
      "Reads control-plane AppInstallation rows. The dashboard filters navigation and guards " +
      "routes with this set; the gateway independently enforces the same flags on @RequiresApp " +
      "routes — hiding is UX, refusal is the api's.",
  })
  @ApiResponse({
    status: 200,
    schema: {
      type: "object",
      required: ["installed"],
      properties: {
        installed: { type: "array", items: { type: "string", enum: [...APP_KEYS] } },
      },
    },
  })
  async entitlementsOfTenant(
    @Req() request: RequestContextCarrier,
  ): Promise<Record<string, unknown>> {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    requireRealm(context.auth, "tenant_staff");
    const installed = await this.entitlements.installedApps(context.tenant.tenantId);
    return { installed };
  }
}

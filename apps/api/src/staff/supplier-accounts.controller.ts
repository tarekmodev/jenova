/**
 * Settings → Supplier accounts (issue #91): the tenant's OWN credentials
 * per supplier + environment (Jenova is a technology partner — identity
 * rules). Credentials are WRITE-ONLY through this surface: stored sealed,
 * never echoed back in any response. Test-connection proves them with the
 * supplier's cheapest authenticated call through the adapter (TBO:
 * CountryList) — never a search.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { isSupplierError, type TenantId } from "@jenova/domain";
import {
  supplierCatalogEntries,
  SUPPLIER_ENVIRONMENTS,
  type ControlPlaneClient,
  type SupplierEnvironment,
} from "@jenova/db";
import { SUPPLIER_REGISTRY, type SupplierRegistry } from "@jenova/supplier-registry";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
  type VerifiedSessionAuth,
} from "../gateway/request-context";
import { CONTROL_PLANE_CLIENT } from "../tenancy/tenant-db.module";
import {
  SUPPLIER_ACCOUNT_ADMIN,
  type SupplierAccountAdmin,
  type SupplierAccountSummary,
} from "./supplier-account-admin";

const upsertBody = z.object({
  secrets: z.record(z.string().min(1).max(64), z.string().min(1).max(2_048)).optional(),
  enabled: z.boolean().optional(),
});

/** Test-connection is a bounded, cheap probe — one supplier hop. */
const TEST_CONNECTION_TIMEOUT_MS = 15_000;

@ApiTags("staff-settings")
@Controller("staff/supplier-accounts")
@RequiresRealm("tenant_staff")
export class SupplierAccountsController {
  constructor(
    @Inject(SUPPLIER_ACCOUNT_ADMIN) private readonly admin: SupplierAccountAdmin,
    @Inject(CONTROL_PLANE_CLIENT) private readonly controlPlane: ControlPlaneClient,
    @Inject(SUPPLIER_REGISTRY) private readonly registry: SupplierRegistry,
  ) {}

  @Get()
  @ApiOperation({
    summary: "Supplier catalog merged with the tenant's account state",
    description:
      "Every platform supplier with, per environment, whether this tenant has credentials saved " +
      "and enabled. Secret material NEVER appears in any response.",
  })
  async list(@Req() request: RequestContextCarrier): Promise<Record<string, unknown>> {
    const { tenant } = this.scope(request);
    const [catalog, accounts] = await Promise.all([
      this.controlPlane.db
        .select()
        .from(supplierCatalogEntries)
        .orderBy(supplierCatalogEntries.supplierCode),
      this.admin.list(tenant.tenantId),
    ]);
    const byAccount = new Map<string, SupplierAccountSummary>(
      accounts.map((account) => [`${account.supplierCode}:${account.environment}`, account]),
    );
    return {
      suppliers: catalog.map((entry) => ({
        supplierCode: entry.supplierCode,
        name: entry.name,
        vertical: entry.vertical,
        certification: {
          sandbox: entry.certificationSandbox,
          production: entry.certificationProduction,
        },
        testable: this.registry.hotelAdapter(entry.supplierCode)?.testConnection !== undefined,
        environments: Object.fromEntries(
          SUPPLIER_ENVIRONMENTS.map((environment) => {
            const account = byAccount.get(`${entry.supplierCode}:${environment}`);
            return [
              environment,
              account === undefined
                ? { configured: false }
                : {
                    configured: true,
                    enabled: account.enabled,
                    updatedAt: account.updatedAt.toISOString(),
                  },
            ];
          }),
        ),
      })),
    };
  }

  @Put(":supplierCode/:environment")
  @ApiOperation({
    summary: "Save credentials and/or the enabled flag (write-only)",
    description:
      "Secrets are sealed at rest and never returned by any endpoint. Creating an account " +
      "requires secrets; later calls may rotate secrets, flip enabled, or both.",
  })
  async upsert(
    @Req() request: RequestContextCarrier,
    @Param("supplierCode") rawCode: string,
    @Param("environment") rawEnvironment: string,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const { tenant, auth } = this.scope(request);
    const { supplierCode, environment } = await this.target(rawCode, rawEnvironment);
    const parsed = upsertBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { secrets?: Record<string,string>, enabled?: boolean }",
        HttpStatus.BAD_REQUEST,
      );
    }
    const outcome = await this.admin.upsert(tenant.tenantId, supplierCode, environment, {
      secrets: parsed.data.secrets,
      enabled: parsed.data.enabled,
      actorId: auth.principal.userId,
    });
    if (!outcome.ok) {
      throw new ApiHttpError(
        "secrets_required",
        "creating a supplier account requires its credentials",
        HttpStatus.BAD_REQUEST,
      );
    }
    return { ok: true, created: outcome.created };
  }

  @Post(":supplierCode/:environment/test-connection")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Prove the stored credentials with the supplier's cheapest call",
    description:
      "Decrypts the stored account at call time and runs the adapter's testConnection probe " +
      "(TBO: GET CountryList). Reports ok, or the unified taxonomy kind (auth_failed for wrong " +
      "credentials). Never a search — look-to-book is a commercial obligation.",
  })
  async testConnection(
    @Req() request: RequestContextCarrier,
    @Param("supplierCode") rawCode: string,
    @Param("environment") rawEnvironment: string,
  ): Promise<Record<string, unknown>> {
    const { tenant } = this.scope(request);
    const { supplierCode, environment } = await this.target(rawCode, rawEnvironment);
    const adapter = this.registry.hotelAdapter(supplierCode);
    if (adapter === null || adapter.testConnection === undefined) {
      throw new ApiHttpError(
        "test_unsupported",
        "no connection probe exists for this supplier",
        HttpStatus.CONFLICT,
      );
    }
    const stored = await this.admin.openSecrets(tenant.tenantId, supplierCode, environment);
    if (stored === null) {
      throw new ApiHttpError(
        "account_not_configured",
        "save credentials before testing the connection",
        HttpStatus.CONFLICT,
      );
    }
    try {
      await adapter.testConnection({
        credentials: {
          tenantId: tenant.tenantId,
          supplierCode,
          environment,
          secrets: stored.secrets,
        },
        deadline: new Date(Date.now() + TEST_CONNECTION_TIMEOUT_MS),
        // Probe context only — static-content reads ignore these, but the
        // AdapterCallContext contract requires them.
        nationality: "SA",
        currency: "SAR",
        locale: "en",
      });
      return { ok: true };
    } catch (error) {
      if (isSupplierError(error)) {
        return { ok: false, kind: error.kind };
      }
      throw error;
    }
  }

  private async target(
    rawCode: string,
    rawEnvironment: string,
  ): Promise<{ supplierCode: string; environment: SupplierEnvironment }> {
    if (!(SUPPLIER_ENVIRONMENTS as readonly string[]).includes(rawEnvironment)) {
      throw new ApiHttpError("supplier_not_found", "unknown supplier account", HttpStatus.NOT_FOUND);
    }
    const known = await this.knownSupplierCodes();
    if (!known.has(rawCode)) {
      throw new ApiHttpError("supplier_not_found", "unknown supplier account", HttpStatus.NOT_FOUND);
    }
    return { supplierCode: rawCode, environment: rawEnvironment as SupplierEnvironment };
  }

  private async knownSupplierCodes(): Promise<ReadonlySet<string>> {
    const rows = await this.controlPlane.db
      .select({ supplierCode: supplierCatalogEntries.supplierCode })
      .from(supplierCatalogEntries);
    return new Set(rows.map((row) => row.supplierCode));
  }

  private scope(request: RequestContextCarrier): {
    tenant: ResolvedTenant & { tenantId: TenantId };
    auth: VerifiedSessionAuth<"tenant_staff">;
  } {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    return { tenant: context.tenant, auth: requireRealm(context.auth, "tenant_staff") };
  }
}

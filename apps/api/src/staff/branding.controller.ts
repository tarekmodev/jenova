/**
 * Settings → Branding (issue #91): legal name, brand color, logo. The
 * shape lives in the control-plane tenant.branding jsonb; the logo binary
 * goes to the object store (docker-compose MinIO in dev) under the
 * tenant's namespace and is served back through this controller (the
 * dashboard proxies it — the store is never exposed directly).
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Put,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { TenantId } from "@jenova/domain";
import { tenants, type ControlPlaneClient } from "@jenova/db";
import type { ObjectStore } from "@jenova/connectors";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
} from "../gateway/request-context";
import { CONTROL_PLANE_CLIENT } from "../tenancy/tenant-db.module";

/** Nest injection token for the process-wide {@link ObjectStore} (or null). */
export const OBJECT_STORE = Symbol("jenova.api.objectStore");

const brandingBody = z.object({
  legalName: z.string().min(1).max(200).optional(),
  brandColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const LOGO_CONTENT_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const;
const LOGO_MAX_BYTES = 512 * 1024;

const logoBody = z.object({
  contentType: z.enum(LOGO_CONTENT_TYPES),
  dataBase64: z.string().min(1),
});

interface BrandingShape {
  readonly legalName?: string;
  readonly brandColor?: string;
  readonly logoKey?: string;
  readonly logoContentType?: string;
}

@ApiTags("staff-settings")
@Controller("staff/branding")
@RequiresRealm("tenant_staff")
export class BrandingController {
  constructor(
    @Inject(CONTROL_PLANE_CLIENT) private readonly controlPlane: ControlPlaneClient,
    @Inject(OBJECT_STORE) private readonly objectStore: ObjectStore | null,
  ) {}

  @Get()
  @ApiOperation({ summary: "Tenant branding (legal name, brand color, logo presence)" })
  async get(@Req() request: RequestContextCarrier): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    const { name, branding } = await this.load(tenant.tenantId);
    return {
      branding: {
        legalName: branding.legalName ?? name,
        brandColor: branding.brandColor ?? null,
        hasLogo: branding.logoKey !== undefined,
      },
    };
  }

  @Put()
  @ApiOperation({ summary: "Update legal name / brand color" })
  async put(
    @Req() request: RequestContextCarrier,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    const parsed = brandingBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { legalName?: string, brandColor?: '#rrggbb' }",
        HttpStatus.BAD_REQUEST,
      );
    }
    const { name, branding } = await this.load(tenant.tenantId);
    const next: BrandingShape = {
      ...branding,
      ...(parsed.data.legalName !== undefined ? { legalName: parsed.data.legalName } : {}),
      ...(parsed.data.brandColor !== undefined ? { brandColor: parsed.data.brandColor } : {}),
    };
    await this.controlPlane.db
      .update(tenants)
      .set({ branding: next as Record<string, unknown> })
      .where(eq(tenants.id, tenant.tenantId));
    return {
      branding: {
        legalName: next.legalName ?? name,
        brandColor: next.brandColor ?? null,
        hasLogo: next.logoKey !== undefined,
      },
    };
  }

  @Put("logo")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Upload the tenant logo to the object store",
    description: "PNG/JPEG/SVG/WebP, ≤ 512KB, base64 payload. Stored under the tenant namespace.",
  })
  async putLogo(
    @Req() request: RequestContextCarrier,
    @Body() rawBody: unknown,
  ): Promise<Record<string, unknown>> {
    const tenant = this.tenant(request);
    const store = this.requireObjectStore();
    const parsed = logoBody.safeParse(rawBody);
    if (!parsed.success) {
      throw new ApiHttpError(
        "bad_request",
        "body must be { contentType: image/*, dataBase64: string }",
        HttpStatus.BAD_REQUEST,
      );
    }
    const bytes = Buffer.from(parsed.data.dataBase64, "base64");
    if (bytes.length === 0 || bytes.length > LOGO_MAX_BYTES) {
      throw new ApiHttpError(
        "logo_too_large",
        `logo must be 1..${String(LOGO_MAX_BYTES)} bytes`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const key = `tenants/${tenant.tenantId}/branding/logo`;
    await store.put(key, bytes, parsed.data.contentType);
    const { branding } = await this.load(tenant.tenantId);
    const next: BrandingShape = {
      ...branding,
      logoKey: key,
      logoContentType: parsed.data.contentType,
    };
    await this.controlPlane.db
      .update(tenants)
      .set({ branding: next as Record<string, unknown> })
      .where(eq(tenants.id, tenant.tenantId));
    return { ok: true };
  }

  @Get("logo")
  @ApiOperation({ summary: "Serve the tenant logo from the object store" })
  async getLogo(@Req() request: RequestContextCarrier, @Res() response: Response): Promise<void> {
    const tenant = this.tenant(request);
    const store = this.requireObjectStore();
    const { branding } = await this.load(tenant.tenantId);
    if (branding.logoKey === undefined) {
      throw new ApiHttpError("logo_not_found", "no logo uploaded", HttpStatus.NOT_FOUND);
    }
    const stored = await store.get(branding.logoKey);
    if (stored === null) {
      throw new ApiHttpError("logo_not_found", "no logo uploaded", HttpStatus.NOT_FOUND);
    }
    response.setHeader("Content-Type", stored.contentType);
    response.setHeader("Cache-Control", "private, max-age=300");
    response.end(Buffer.from(stored.bytes));
  }

  private requireObjectStore(): ObjectStore {
    if (this.objectStore === null) {
      throw new ApiHttpError(
        "object_store_unconfigured",
        "object storage is not configured (S3_* environment)",
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return this.objectStore;
  }

  private async load(
    tenantId: TenantId,
  ): Promise<{ name: string; branding: BrandingShape }> {
    const rows = await this.controlPlane.db
      .select({ name: tenants.name, branding: tenants.branding })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      throw ApiHttpError.internal("resolved tenant has no control-plane row");
    }
    return { name: row.name, branding: row.branding as BrandingShape };
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

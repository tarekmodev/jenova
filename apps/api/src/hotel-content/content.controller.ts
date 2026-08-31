/**
 * Agency-realm hotel content endpoints (M2 issue #96) — the destination /
 * property pickers behind the Agent Portal's search form. Thin binding:
 * caching, supplier selection and normalization live in the service and the
 * adapters (CLAUDE.md rules 2 & 4).
 */

import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { isSupplierError, LOCALES, type Locale } from "@jenova/domain";
import { RequiresRealm } from "../gateway/decorators";
import { ApiHttpError } from "../gateway/errors";
import {
  getRequestContext,
  requireRealm,
  type RequestContextCarrier,
  type ResolvedTenant,
} from "../gateway/request-context";
import { isOfferError, SupplierUnavailableError, toOfferHttpError } from "../offers/errors";
import { HOTEL_CONTENT_SERVICE, type HotelContentService } from "./content.service";

const countryCodeParam = z.string().regex(/^[A-Z]{2}$/);
const cityIdParam = z.string().regex(/^[0-9A-Za-z_-]{1,64}$/);

function localeOf(raw: unknown): Locale {
  const parsed = z.enum(LOCALES).safeParse(raw);
  return parsed.success ? parsed.data : "en";
}

function toHttp(error: unknown): never {
  if (isOfferError(error) || error instanceof SupplierUnavailableError || isSupplierError(error)) {
    throw toOfferHttpError(error);
  }
  throw error;
}

@ApiTags("hotel-content")
@Controller("hotel-content")
export class HotelContentController {
  constructor(
    @Inject(HOTEL_CONTENT_SERVICE) private readonly content: HotelContentService,
  ) {}

  @Get("countries")
  @RequiresRealm("agency")
  @ApiOperation({ summary: "Country list from the tenant's content-capable supplier (cached)" })
  async countries(@Req() request: RequestContextCarrier, @Query("locale") locale?: string) {
    const tenant = this.tenantOf(request);
    try {
      return { countries: await this.content.listCountries(tenant.tenantId, localeOf(locale)) };
    } catch (error) {
      toHttp(error);
    }
  }

  @Get("countries/:code/cities")
  @RequiresRealm("agency")
  @ApiOperation({ summary: "City list for a country (cached)" })
  async cities(
    @Req() request: RequestContextCarrier,
    @Param("code") code: string,
    @Query("locale") locale?: string,
  ) {
    const tenant = this.tenantOf(request);
    const parsed = countryCodeParam.safeParse(code);
    if (!parsed.success) {
      throw new ApiHttpError("bad_request", "country code must be ISO 3166-1 alpha-2", 400);
    }
    try {
      return {
        cities: await this.content.listCities(tenant.tenantId, parsed.data, localeOf(locale)),
      };
    } catch (error) {
      toHttp(error);
    }
  }

  @Get("cities/:cityId/properties")
  @RequiresRealm("agency")
  @ApiOperation({
    summary: "Property list for a city (cached) — canonical ids usable as search targets",
  })
  async properties(
    @Req() request: RequestContextCarrier,
    @Param("cityId") cityId: string,
    @Query("locale") locale?: string,
  ) {
    const tenant = this.tenantOf(request);
    const parsed = cityIdParam.safeParse(cityId);
    if (!parsed.success) {
      throw new ApiHttpError("bad_request", "unknown city id", 400);
    }
    try {
      return {
        properties: await this.content.listProperties(tenant.tenantId, parsed.data, localeOf(locale)),
      };
    } catch (error) {
      toHttp(error);
    }
  }

  private tenantOf(request: RequestContextCarrier): ResolvedTenant {
    const context = getRequestContext(request);
    if (context === null || context.tenant === null) {
      throw ApiHttpError.internal("request context is missing its tenant");
    }
    requireRealm(context.auth, "agency");
    return context.tenant;
  }
}

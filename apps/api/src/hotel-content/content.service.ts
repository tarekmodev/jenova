/**
 * Hotel content service (M2 issue #96): country / city / property lists for
 * the Agent Portal's destination picker, served through the designated
 * static-content read-through cache (issue #61) so the portal can never
 * hammer supplier content endpoints — look-to-book budgets are commercial
 * obligations (docs/05).
 *
 * Content comes from the FIRST enabled supplier account whose adapter
 * exposes the content capability (M2: TBO). Multi-supplier merge is an M3
 * concern (mapping service).
 */

import { z } from "zod";
import type { Locale, TenantId } from "@jenova/domain";
import type {
  AdapterCallContext,
  ContentCity,
  ContentCountry,
  ContentProperty,
  HotelContentAdapter,
} from "@jenova/supplier-sdk";
import type { SupplierCredentialsSource, SupplierRegistry } from "@jenova/supplier-registry";
import { SupplierUnavailableError } from "../offers/errors";
import type { StaticContentCache } from "../hotel-search/static-content-cache";
import type { SupplierAccountsSource } from "../hotel-search/supplier-accounts";

export const HOTEL_CONTENT_SERVICE = Symbol("jenova.api.hotelContentService");

/** Supplier content call budget — content is slow-moving and cached for a day. */
const CONTENT_DEADLINE_MS = 20_000;

const countriesSchema = z.array(z.object({ code: z.string(), name: z.string() }));
const citiesSchema = z.array(
  z.object({ cityId: z.string(), name: z.string(), countryCode: z.string() }),
);
const propertiesSchema = z.array(
  z.object({
    canonicalPropertyId: z.string(),
    name: z.string(),
    cityId: z.string(),
    countryCode: z.string(),
  }),
);

export class HotelContentService {
  constructor(
    private readonly registry: SupplierRegistry,
    private readonly accounts: SupplierAccountsSource,
    private readonly credentials: SupplierCredentialsSource,
    private readonly cache: StaticContentCache,
  ) {}

  async listCountries(tenant: TenantId, locale: Locale): Promise<readonly ContentCountry[]> {
    const { adapter } = await this.contentAdapterFor(tenant);
    return this.cache.getOrLoad(
      { tenant, supplierCode: adapter.supplierCode, resource: "country-list", params: [] },
      countriesSchema,
      async () => [...(await adapter.listCountries(await this.context(tenant, adapter, locale)))],
    );
  }

  async listCities(
    tenant: TenantId,
    countryCode: string,
    locale: Locale,
  ): Promise<readonly ContentCity[]> {
    const { adapter } = await this.contentAdapterFor(tenant);
    return this.cache.getOrLoad(
      { tenant, supplierCode: adapter.supplierCode, resource: "city-list", params: [countryCode] },
      citiesSchema,
      async () => [
        ...(await adapter.listCities(await this.context(tenant, adapter, locale), countryCode)),
      ],
    );
  }

  async listProperties(
    tenant: TenantId,
    cityId: string,
    locale: Locale,
  ): Promise<readonly ContentProperty[]> {
    const { adapter } = await this.contentAdapterFor(tenant);
    return this.cache.getOrLoad(
      {
        tenant,
        supplierCode: adapter.supplierCode,
        resource: "hotel-code-list",
        params: [cityId],
      },
      propertiesSchema,
      async () => [
        ...(await adapter.listProperties(await this.context(tenant, adapter, locale), cityId)),
      ],
    );
  }

  private async contentAdapterFor(
    tenant: TenantId,
  ): Promise<{ adapter: HotelContentAdapter }> {
    const enabled = await this.accounts.enabledSupplierCodes(tenant);
    for (const supplierCode of enabled) {
      const adapter = this.registry.hotelContent(supplierCode);
      if (adapter !== null) {
        return { adapter };
      }
    }
    throw new SupplierUnavailableError(enabled[0] ?? "none");
  }

  private async context(
    tenant: TenantId,
    adapter: HotelContentAdapter,
    locale: Locale,
  ): Promise<AdapterCallContext> {
    return {
      credentials: await this.credentials.credentialsFor(tenant, adapter.supplierCode),
      deadline: new Date(Date.now() + CONTENT_DEADLINE_MS),
      // Content calls price nothing: the contract requires adapters to
      // ignore these two. "ZZ" is ISO 3166's user-assigned "not applicable".
      nationality: "ZZ",
      currency: "USD",
      locale,
    };
  }
}

/**
 * TBO static content (M2 issue #96): CountryList / CityList /
 * TBOHotelCodeList translated to the canonical supplier-sdk content shapes.
 * Response schemas are written from the REAL recorded sandbox traffic in
 * packages/sandbox-replay/recordings/tbo (CLAUDE.md rule 5); request bodies
 * byte-match what the recorder captured.
 */

import { z } from "zod";
import {
  parseJsonWith,
  type AdapterCallContext,
  type ContentCity,
  type ContentCountry,
  type ContentProperty,
  type HotelContentAdapter,
  type Transport,
  type TransportResponse,
} from "@jenova/supplier-sdk";
import { TBO_SUPPLIER_CODE, TboClient } from "./client";
import { supplierErrorFromHttp, supplierErrorFromStatus, TBO_STATUS_OK } from "./errors";
import { toCanonicalPropertyId } from "./mapping";
import { tboStatusSchema } from "./schemas";

/** {"Status":…,"CountryList":[{"Code":"SA","Name":"Saudi Arabia"},…]} */
const countryListSchema = z.object({
  Status: tboStatusSchema,
  CountryList: z.array(z.object({ Code: z.string(), Name: z.string() })).optional(),
});

/** {"Status":…,"CityList":[{"Code":"147536","Name":"Riyadh"},…]} */
const cityListSchema = z.object({
  Status: tboStatusSchema,
  CityList: z.array(z.object({ Code: z.string(), Name: z.string() })).optional(),
});

/** {"Status":…,"Hotels":[{"HotelCode":"1010062","HotelName":…,"CountryCode":"SA",…},…]} */
const hotelCodeListSchema = z.object({
  Status: tboStatusSchema,
  Hotels: z
    .array(
      z.object({
        HotelCode: z.string(),
        HotelName: z.string(),
        CountryCode: z.string().optional(),
      }),
    )
    .optional(),
});

function assertHttpOk(response: TransportResponse, operation: string): void {
  if (response.status < 200 || response.status >= 300) {
    throw supplierErrorFromHttp(response, operation);
  }
}

class TboContentAdapter implements HotelContentAdapter {
  readonly supplierCode = TBO_SUPPLIER_CODE;
  readonly #client: TboClient;

  constructor(transport: Transport) {
    this.#client = new TboClient(transport);
  }

  async listCountries(ctx: AdapterCallContext): Promise<readonly ContentCountry[]> {
    const response = await this.#client.call(ctx, "countryList");
    assertHttpOk(response, "countryList");
    const body = parseJsonWith(countryListSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    if (body.Status.Code !== TBO_STATUS_OK) {
      throw supplierErrorFromStatus(body.Status, "countryList");
    }
    return (body.CountryList ?? []).map((entry) => ({ code: entry.Code, name: entry.Name }));
  }

  async listCities(ctx: AdapterCallContext, countryCode: string): Promise<readonly ContentCity[]> {
    const response = await this.#client.call(ctx, "cityList", { CountryCode: countryCode });
    assertHttpOk(response, "cityList");
    const body = parseJsonWith(cityListSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    if (body.Status.Code !== TBO_STATUS_OK) {
      throw supplierErrorFromStatus(body.Status, "cityList");
    }
    return (body.CityList ?? []).map((entry) => ({
      cityId: entry.Code,
      name: entry.Name,
      countryCode,
    }));
  }

  async listProperties(ctx: AdapterCallContext, cityId: string): Promise<readonly ContentProperty[]> {
    // IsDetailedResponse is the STRING "false" — exactly what TBO expects
    // and what the recording captured; a boolean is a different fingerprint.
    const response = await this.#client.call(ctx, "hotelCodeList", {
      CityCode: cityId,
      IsDetailedResponse: "false",
    });
    assertHttpOk(response, "hotelCodeList");
    const body = parseJsonWith(hotelCodeListSchema, response.body, {
      supplierCode: TBO_SUPPLIER_CODE,
    });
    if (body.Status.Code !== TBO_STATUS_OK) {
      throw supplierErrorFromStatus(body.Status, "hotelCodeList");
    }
    // The response does not echo the city code; the caller's cityId scopes it.
    return (body.Hotels ?? []).map((hotel) => ({
      canonicalPropertyId: toCanonicalPropertyId(hotel.HotelCode),
      name: hotel.HotelName,
      cityId,
      countryCode: hotel.CountryCode ?? "",
    }));
  }
}

export function createTboContentAdapter(options: { transport: Transport }): HotelContentAdapter {
  return new TboContentAdapter(options.transport);
}

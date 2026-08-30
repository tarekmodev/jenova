/**
 * Deliberate TBO sandbox recording sessions (docs/09-testing.md).
 *
 * Every call here runs LIVE against the TBO sandbox through the supplier-sdk
 * client wrapped by the sandbox-replay recorder: the raw capture lands in
 * raw-captures/ (gitignored), the sanitized recording in recordings/tbo/
 * (committed). Look-to-book is a commercial obligation — run scenarios
 * one at a time, on purpose, and reuse recordings during development.
 *
 *   pnpm --filter @jenova/adapter-hotel-tbo record <scenario> [args...]
 */

import { TboClient, createTboTransport, type TboEndpoint } from "../src/index";
import { loadRepoEnv, recordingContext, type RecordingContextOverrides } from "./env";

loadRepoEnv();

function excerpt(body: string, length = 600): string {
  return body.length <= length ? body : `${body.slice(0, length)} … (${body.length} chars)`;
}

async function call(
  endpoint: TboEndpoint,
  payload?: unknown,
  overrides: RecordingContextOverrides = {},
): Promise<void> {
  const client = new TboClient(createTboTransport({ mode: "record" }));
  const ctx = recordingContext(overrides);
  const response = await client.call(ctx, endpoint, payload);
  console.log(`${endpoint} -> HTTP ${response.status}`);
  console.log(excerpt(response.body));
}

const [scenario, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (scenario) {
    case "countryList":
      return call("countryList");
    case "cityList":
      return call("cityList", { CountryCode: args[0] ?? "SA" });
    case "hotelCodeList":
      return call("hotelCodeList", { CityCode: args[0], IsDetailedResponse: "false" });
    case "hotelDetails":
      return call("hotelDetails", { Hotelcodes: args[0], Language: "EN" });
    case "search": {
      const [hotelCodes, checkIn, checkOut, adults] = args;
      return call("search", {
        CheckIn: checkIn,
        CheckOut: checkOut,
        HotelCodes: hotelCodes,
        GuestNationality: "SA",
        PaxRooms: [{ Adults: Number(adults ?? 1), Children: 0, ChildrenAges: [] }],
        ResponseTime: 23.0,
        IsDetailedResponse: true,
      });
    }
    default:
      throw new Error(`unknown scenario: ${String(scenario)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

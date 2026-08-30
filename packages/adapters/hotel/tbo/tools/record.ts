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

import { createTboHotelAdapter, TboClient, createTboTransport, type TboEndpoint } from "../src/index";
import {
  makeRecordedBookRequest,
  pickLifecycleOffer,
  RECORDED_SEARCH_QUERY,
} from "../src/recorded-scenarios";
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
    case "searchRaw": {
      // Error-scenario searches (bad codes, far-future no-availability):
      // same payload shape the adapter builds, distinct fingerprints.
      const [hotelCodes, checkIn, checkOut] = args;
      return call("search", {
        CheckIn: checkIn,
        CheckOut: checkOut,
        HotelCodes: hotelCodes,
        GuestNationality: "SA",
        PaxRooms: [{ Adults: 1, Children: 0, ChildrenAges: [] }],
        ResponseTime: 23.0,
        IsDetailedResponse: true,
      });
    }
    case "searchBadAuth": {
      // auth_failed scenario: wrong password from a SCRATCH variable (the
      // real .env is untouched); the sanitized recording keeps only the
      // 401 response, and credentials never enter the fingerprint.
      const [hotelCodes, checkIn, checkOut] = args;
      return call(
        "search",
        {
          CheckIn: checkIn,
          CheckOut: checkOut,
          HotelCodes: hotelCodes,
          GuestNationality: "SA",
          PaxRooms: [{ Adults: 1, Children: 0, ChildrenAges: [] }],
          ResponseTime: 23.0,
          IsDetailedResponse: true,
        },
        { password: process.env["TBO_HOTEL_SCRATCH_PASSWORD"] ?? "jenova-wrong-password-probe" },
      );
    }
    case "cancelRaw":
      return call("cancel", { ConfirmationNumber: args[0] });
    case "search": {
      // The canonical recorded scenario, through the real adapter, so the
      // recording fingerprint always matches what the adapter sends.
      const adapter = createTboHotelAdapter({ transport: createTboTransport({ mode: "record" }) });
      const offers = await adapter.search(recordingContext(), RECORDED_SEARCH_QUERY);
      console.log(`search -> ${offers.length} offers`);
      for (const offer of offers.slice(0, 5)) {
        console.log(
          `${offer.canonicalPropertyId} ${offer.boardBasis} ${offer.net.amount} ${offer.net.currency} refundable=${offer.cancellationPolicy.refundable} ${offer.supplierRoomName}`,
        );
      }
      return;
    }
    case "lifecycle": {
      // The full recorded proof: search -> check -> book -> retrieve ->
      // cancel ONE real sandbox reservation (cheapest refundable rate with
      // free cancellation, cancelled immediately). Every hop is recorded.
      const adapter = createTboHotelAdapter({ transport: createTboTransport({ mode: "record" }) });
      const ctx = () => recordingContext();
      const offers = await adapter.search(ctx(), RECORDED_SEARCH_QUERY);
      console.log(`search -> ${offers.length} offers`);
      const offer = pickLifecycleOffer(offers);
      console.log(
        `picked ${offer.canonicalPropertyId} "${offer.supplierRoomName}" ${offer.net.amount} ${offer.net.currency}`,
      );
      const checked = await adapter.check(ctx(), offer.supplierOfferToken);
      console.log(`check -> ok, net ${checked.net.amount} ${checked.net.currency}`);
      const booked = await adapter.book(ctx(), makeRecordedBookRequest(checked));
      console.log(
        `book -> ${booked.status}, ref ${booked.supplierBookingReference}, clientReference ${booked.clientReference}`,
      );
      const retrieved = await adapter.retrieve(ctx(), booked.supplierBookingReference);
      console.log(`retrieve -> ${retrieved.status}, clientReference ${retrieved.clientReference}`);
      const cancelled = await adapter.cancel(ctx(), booked.supplierBookingReference);
      console.log(`cancel -> ${cancelled.status}`);
      return;
    }
    case "resume": {
      // Finish an interrupted lifecycle session: retrieve + cancel the given
      // live sandbox reservation through the adapter, recording both hops.
      const adapter = createTboHotelAdapter({ transport: createTboTransport({ mode: "record" }) });
      const reference = args[0];
      if (reference === undefined) throw new Error("usage: record resume <confirmationNumber>");
      const retrieved = await adapter.retrieve(recordingContext(), reference);
      console.log(`retrieve -> ${retrieved.status}, net ${retrieved.net.amount} ${retrieved.net.currency}`);
      const cancelled = await adapter.cancel(recordingContext(), reference);
      console.log(`cancel -> ${cancelled.status}`);
      return;
    }
    case "retrieveBooking": {
      const adapter = createTboHotelAdapter({ transport: createTboTransport({ mode: "record" }) });
      const reference = args[0];
      if (reference === undefined) throw new Error("usage: record retrieveBooking <confirmationNumber>");
      const retrieved = await adapter.retrieve(recordingContext(), reference);
      console.log(
        `retrieve -> ${retrieved.status}, net ${retrieved.net.amount} ${retrieved.net.currency}, refundable=${retrieved.cancellationPolicy.refundable}`,
      );
      return;
    }
    case "prebook":
      // Exact payload shape the adapter's check() sends — the recording it
      // produces is replayable by the adapter tests.
      return call("check", { BookingCode: args[0], PaymentMode: "Limit" });
    case "bookingDetail":
      return call("retrieve", { ConfirmationNumber: args[0], PaymentMode: "Limit" });
    default:
      throw new Error(`unknown scenario: ${String(scenario)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

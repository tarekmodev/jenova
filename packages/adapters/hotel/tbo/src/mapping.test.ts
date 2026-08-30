import { describe, expect, it } from "vitest";
import { isSupplierError, money } from "@jenova/domain";
import {
  decodeOfferToken,
  encodeOfferToken,
  mapCancellationPolicy,
  normalizeBoardBasis,
  tboAmountToMoney,
  tboDateTimeToUtcIso,
  toCanonicalPropertyId,
  toTboHotelCode,
  type TboOfferTokenV1,
} from "./mapping";

function catching(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("tboAmountToMoney — exact decimal to minor units", () => {
  // Amounts observed verbatim on the recorded search response.
  it.each([
    [1057.12, "USD", 105712],
    [139.73, "USD", 13973],
    [111.2, "USD", 11120],
    [187, "USD", 18700],
    [0, "USD", 0],
  ])("converts recorded wire value %s %s to %i minor units", (amount, currency, minor) => {
    expect(tboAmountToMoney(amount, currency)).toEqual(money(minor, currency));
  });

  it("honours ISO 4217 exponents (3-digit dinars, 0-digit yen)", () => {
    expect(tboAmountToMoney(1.234, "KWD")).toEqual(money(1234, "KWD"));
    expect(tboAmountToMoney(100, "JPY")).toEqual(money(100, "JPY"));
  });

  it("rounds sub-minor-unit precision half away from zero (documented policy)", () => {
    expect(tboAmountToMoney(1.005, "USD").amount).toBe(101);
    expect(tboAmountToMoney(-1.005, "USD").amount).toBe(-101);
    expect(tboAmountToMoney(1.0049, "USD").amount).toBe(100);
    expect(tboAmountToMoney(0.5, "JPY").amount).toBe(1);
  });

  it("rejects non-finite amounts as invalid_request", () => {
    const error = catching(() => tboAmountToMoney(Number.NaN, "USD"));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });
});

describe("normalizeBoardBasis", () => {
  // Left side: meal types observed on real recordings; right: canonical.
  it.each([
    ["Room_Only", "RO"],
    ["BreakFast", "BB"],
    ["Breakfast_For_2", "BB"],
    ["Half_Board", "HB"],
    ["Full_Board", "FB"],
    ["All_Inclusive", "AI"],
  ])("maps %s to %s", (mealType, basis) => {
    expect(normalizeBoardBasis(mealType)).toBe(basis);
  });

  it("returns undefined for unknown meal types (room skipped, never mislabeled)", () => {
    expect(normalizeBoardBasis("Dinner_Cruise_Special")).toBeUndefined();
  });
});

describe("tboDateTimeToUtcIso — IST (UTC+05:30) resolution, documented in README", () => {
  it("resolves a recorded deadline to the UTC instant 5h30 earlier", () => {
    expect(tboDateTimeToUtcIso("29-08-2026 00:00:00")).toBe("2026-08-28T18:30:00.000Z");
    expect(tboDateTimeToUtcIso("12-10-2026 00:00:00")).toBe("2026-10-11T18:30:00.000Z");
  });

  it("rejects unrecognized formats as invalid_request", () => {
    const error = catching(() => tboDateTimeToUtcIso("2026-08-29T00:00:00Z"));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });
});

describe("mapCancellationPolicy", () => {
  // The policy shape recorded on hotel 1065918's refundable Studio rate.
  const recorded = [
    { FromDate: "29-08-2026 00:00:00", ChargeType: "Fixed", CancellationCharge: 0 },
    { FromDate: "11-10-2026 00:00:00", ChargeType: "Percentage", CancellationCharge: 100 },
  ];

  it("maps Fixed to Money and Percentage to a share of the net, rules UTC-ordered", () => {
    const net = money(13973, "USD");
    const policy = mapCancellationPolicy(recorded, net, true);
    expect(policy.refundable).toBe(true);
    expect(policy.rules).toEqual([
      { fromUtc: "2026-08-28T18:30:00.000Z", penalty: money(0, "USD") },
      { fromUtc: "2026-10-10T18:30:00.000Z", penalty: money(13973, "USD") },
    ]);
  });

  it("computes partial percentages against the net in integer math", () => {
    const net = money(11120, "USD");
    const policy = mapCancellationPolicy(
      [{ FromDate: "11-10-2026 00:00:00", ChargeType: "Percentage", CancellationCharge: 50 }],
      net,
      true,
    );
    expect(policy.rules[0]?.penalty).toEqual(money(5560, "USD"));
  });

  it("rejects unknown charge types as invalid_request", () => {
    const error = catching(() =>
      mapCancellationPolicy(
        [{ FromDate: "11-10-2026 00:00:00", ChargeType: "Nights", CancellationCharge: 1 }],
        money(11120, "USD"),
        true,
      ),
    );
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });

  it("maps an absent CancelPolicies array to a rule-less policy", () => {
    expect(mapCancellationPolicy(undefined, money(11120, "USD"), false)).toEqual({
      refundable: false,
      rules: [],
    });
  });
});

describe("offer token", () => {
  const token: TboOfferTokenV1 = {
    v: 1,
    bookingCode: "1065918!TB!1!TB!structural-token",
    hotelCode: "1065918",
    currency: "USD",
    totalFare: 139.73,
    roomName: "Studio,2 Twin Beds",
    boardBasis: "RO",
    refundable: true,
    nationality: "SA",
  };

  it("round-trips", () => {
    expect(decodeOfferToken(encodeOfferToken(token))).toEqual(token);
  });

  it("rejects garbage as invalid_request", () => {
    const error = catching(() => decodeOfferToken("not-a-token"));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });
});

describe("canonical property ids (pre-M3 prefix scheme)", () => {
  it("round-trips tbo:<hotelCode>", () => {
    expect(toCanonicalPropertyId("1065918")).toBe("tbo:1065918");
    expect(toTboHotelCode("tbo:1065918")).toBe("1065918");
  });

  it("rejects foreign canonical ids as invalid_request", () => {
    const error = catching(() => toTboHotelCode("giata:12345"));
    expect(isSupplierError(error) && error.kind).toBe("invalid_request");
  });
});

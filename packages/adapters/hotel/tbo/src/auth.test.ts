import { describe, expect, it } from "vitest";
import { isSupplierError, tenantId } from "@jenova/domain";
import type { SupplierAccountCredentials } from "@jenova/supplier-sdk";
import { basicAuthorization, tboAccount } from "./auth";

function credentials(
  secrets: Readonly<Record<string, string>>,
): SupplierAccountCredentials {
  return {
    tenantId: tenantId("t-structural"),
    supplierCode: "tbo",
    environment: "sandbox",
    secrets,
  };
}

const COMPLETE = {
  apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI/",
  username: "structural-user",
  password: "structural-pass",
};

describe("tboAccount", () => {
  it("extracts the account and strips trailing slashes from the base URL", () => {
    const account = tboAccount(credentials(COMPLETE));
    expect(account.apiUrl).toBe("https://api.tbotechnology.in/TBOHolidays_HotelAPI");
    expect(account.username).toBe("structural-user");
    expect(account.password).toBe("structural-pass");
  });

  it.each(["apiUrl", "username", "password"] as const)(
    "rejects with auth_failed naming a missing %s before any network call",
    (key) => {
      const secrets: Record<string, string> = { ...COMPLETE };
      delete secrets[key];
      let caught: unknown;
      try {
        tboAccount(credentials(secrets));
      } catch (error) {
        caught = error;
      }
      expect(isSupplierError(caught) && caught.kind).toBe("auth_failed");
      expect(isSupplierError(caught) && caught.message).toContain(key);
    },
  );

  it("treats blank secrets as missing", () => {
    let caught: unknown;
    try {
      tboAccount(credentials({ ...COMPLETE, password: "  " }));
    } catch (error) {
      caught = error;
    }
    expect(isSupplierError(caught) && caught.kind).toBe("auth_failed");
  });
});

describe("basicAuthorization", () => {
  it("builds the RFC 7617 header value", () => {
    const header = basicAuthorization({
      apiUrl: "https://api.tbotechnology.in/TBOHolidays_HotelAPI",
      username: "user",
      password: "pass",
    });
    expect(header).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });
});

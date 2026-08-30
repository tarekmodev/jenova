/**
 * Agent Portal full flow, per locale project (ar first — CLAUDE.md rule 9):
 *
 *   login → streaming search (SSE) → offer detail → check (unchanged) →
 *   book (recorded certification lifecycle, LVFXI5) → confirmation →
 *   bookings list → detail → cancellation fee preview → cancel → cancelled
 *
 * Everything runs through the REAL portal + REAL api; the supplier side is
 * the committed recordings of the live TBO sandbox lifecycle (rule 5). The
 * search→book timing is measured against docs/apps/b2b.md's 90-second
 * heuristic on a phone viewport and reported honestly in the output.
 */

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  AGENT_EMAIL,
  AGENT_PASSWORD,
  RECORDED_CHECK_IN,
  RECORDED_CHECK_OUT,
  RECORDED_CITY_NAME,
  RECORDED_CLIENT_REFERENCE,
  RECORDED_CONFIRMATION_NUMBER,
  RECORDED_GUEST,
  RECORDED_HOLDER,
  RECORDED_ROOM_NAME,
  SEARCH_TO_BOOK_BUDGET_MS,
} from "./harness/constants";

/**
 * The handful of localized strings the flow must SEE (duplicated from the
 * portal's catalogs — e2e may not import app code, ESLint boundary).
 */
const L10N = {
  ar: {
    dir: "rtl",
    searchTitle: "بحث الفنادق",
    confirmCancel: "تأكيد الإلغاء",
    confirmedState: "مؤكد",
    cancelledState: "ملغى",
    policyHeading: "سياسة الإلغاء",
  },
  en: {
    dir: "ltr",
    searchTitle: "Hotel search",
    confirmCancel: "Confirm cancellation",
    confirmedState: "Confirmed",
    cancelledState: "Cancelled",
    policyHeading: "Cancellation policy",
  },
} as const;

type ProjectLocale = keyof typeof L10N;

async function shot(page: Page, info: TestInfo, name: string): Promise<void> {
  const path = info.outputPath(`${info.project.name}-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await info.attach(`${info.project.name}-${name}`, { path, contentType: "image/png" });
}

test("login → streamed search → check → book → manage → cancel", async ({ page }, testInfo) => {
  const locale = testInfo.project.name as ProjectLocale;
  const t = L10N[locale];

  // --- login (Arabic-first: default is ar; the en run switches first) ------
  await page.goto("/login");
  if (locale === "en") {
    await page.getByTestId("locale-switcher").click();
    await page.waitForLoadState("load");
  }
  await expect(page.locator("html")).toHaveAttribute("dir", t.dir);
  await shot(page, testInfo, "01-login");

  await page.getByTestId("login-email").fill(AGENT_EMAIL);
  await page.getByTestId("login-password").fill(AGENT_PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.waitForURL("**/search");
  await expect(page.getByText(t.searchTitle).first()).toBeVisible();

  // --- search form ---------------------------------------------------------
  // Nationality: first-class, ALWAYS visible, defaulted per agency (rule 9).
  await expect(page.getByTestId("search-nationality")).toBeVisible();
  await expect(page.getByTestId("search-nationality")).toHaveValue(/\(SA\)/, {
    timeout: 30_000,
  });

  await page.getByTestId("search-city").click();
  await page.getByTestId("search-city").fill(RECORDED_CITY_NAME);
  await page.getByRole("option", { name: RECORDED_CITY_NAME, exact: true }).click();

  await page.getByTestId("search-checkin").fill(RECORDED_CHECK_IN);
  await page.getByTestId("search-checkout").fill(RECORDED_CHECK_OUT);

  // Occupancy: the recorded lifecycle stay is one room, one adult.
  await page.getByTestId("room-0-adults").click();
  await page.getByRole("option", { name: "1", exact: true }).click();

  await shot(page, testInfo, "02-search-form");

  // --- streaming search → book: the 90-second benchmark window ------------
  const benchmarkStart = Date.now();
  await page.getByTestId("search-submit").click();

  const studioCard = page
    .getByTestId("offer-card")
    .filter({ hasText: RECORDED_ROOM_NAME })
    .first();
  await expect(studioCard).toBeVisible({ timeout: 60_000 });
  await shot(page, testInfo, "03-results-streamed");
  await studioCard.getByTestId("offer-select").click();

  // --- offer detail: auto-check must come back "unchanged" ----------------
  await expect(page.getByTestId("check-unchanged")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(t.policyHeading).first()).toBeVisible();
  await shot(page, testInfo, "04-offer-checked");

  // --- book form (recorded holder/guest/reference, byte-matching replay) --
  await page.getByTestId("holder-first-name").fill(RECORDED_HOLDER.firstName);
  await page.getByTestId("holder-last-name").fill(RECORDED_HOLDER.lastName);
  await page.getByTestId("holder-email").fill(RECORDED_HOLDER.email);
  await page.getByTestId("holder-phone").fill(RECORDED_HOLDER.phone);
  await page.getByTestId("guest-0-0-first").fill(RECORDED_GUEST.firstName);
  await page.getByTestId("guest-0-0-last").fill(RECORDED_GUEST.lastName);
  await page.getByTestId("client-reference").fill(RECORDED_CLIENT_REFERENCE);
  await page.getByTestId("book-submit").click();

  await expect(page.getByTestId("booking-confirmation")).toBeVisible({ timeout: 60_000 });
  const searchToBookMs = Date.now() - benchmarkStart;
  await expect(page.getByTestId("confirmation-supplier-ref")).toHaveText(
    RECORDED_CONFIRMATION_NUMBER,
  );
  await expect(page.getByText(t.confirmedState).first()).toBeVisible();
  await expect(page.getByTestId("voucher-stub")).toBeVisible();
  await shot(page, testInfo, "05-confirmation");

  // docs/apps/b2b.md: search → book in under 90 seconds. Reported honestly.
  console.log(
    `[benchmark] ${locale}: search → booked confirmation in ${String(searchToBookMs)} ms ` +
      `(budget ${String(SEARCH_TO_BOOK_BUDGET_MS)} ms)`,
  );
  testInfo.annotations.push({
    type: "search-to-book-ms",
    description: `${locale}: ${String(searchToBookMs)}`,
  });
  expect(searchToBookMs).toBeLessThan(SEARCH_TO_BOOK_BUDGET_MS);

  // --- bookings list → detail ---------------------------------------------
  await page.goto("/bookings");
  await expect(page.getByTestId("bookings-list")).toBeVisible();
  const row = page.getByText(RECORDED_CLIENT_REFERENCE).first();
  await expect(row).toBeVisible();
  await shot(page, testInfo, "06-bookings-list");
  await row.click();

  await expect(page.getByTestId("booking-detail")).toBeVisible();
  await expect(page.getByTestId("detail-supplier-ref")).toHaveText(RECORDED_CONFIRMATION_NUMBER);
  await expect(page.getByText(t.policyHeading).first()).toBeVisible();
  await expect(page.getByTestId("state-history")).toBeVisible();
  await shot(page, testInfo, "07-booking-detail");

  // --- cancellation: fee preview BEFORE any supplier call ------------------
  await page.getByTestId("cancel-booking").click();
  await expect(page.getByTestId("fee-preview")).toBeVisible();
  await shot(page, testInfo, "08-fee-preview");
  await page.getByRole("button", { name: t.confirmCancel }).click();

  // The recorded lifecycle's cancel is ASYNC: TBO accepted the request and
  // reported CancellationInProgress (it never settled to Cancelled in the
  // recorded traffic), so the ONLY honest end-state is "cancellation in
  // progress" — state unchanged, cancel intent armed, no premature
  // "cancelled" (the worker settles it when the supplier reports so).
  await expect(page.getByTestId("cancellation-pending")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("cancel-booking")).toHaveCount(0);
  await shot(page, testInfo, "09-cancellation-pending");
});

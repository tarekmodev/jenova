/**
 * Internal Dashboard e2e (M2 #89–#92), replay-backed, in BOTH locales:
 * the `ar` project runs the whole flow right-to-left (the product
 * default), the `en` project left-to-right. Everything travels the real
 * stack — browser → Next BFF → api gateway → engine services → TBO
 * adapter in replay mode over committed recordings on a provisioned
 * throwaway tenant database. Screenshots land in e2e/screenshots/<locale>.
 *
 * login → navigation/entitlements → settings (users, suppliers incl.
 * test-connection, branding) → bookings list + detail (audit + ledger) →
 * manual-intervention queue (retry-poll settles a recorded pending item)
 * → search console streaming → logout.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

interface State {
  readonly adminEmail: string;
  readonly adminPassword: string;
}

const state = JSON.parse(
  readFileSync(fileURLToPath(new URL("../.tmp/state.json", import.meta.url)), "utf8"),
) as State;

/** The committed Riyadh search recording's own request inputs (rule 5). */
const RECORDED_PROPERTY_IDS =
  "tbo:1010062,tbo:1032860,tbo:1037420,tbo:1065918,tbo:1065929," +
  "tbo:1065933,tbo:1065937,tbo:1065954,tbo:1077182,tbo:1087447";
const RECORDED_CHECK_IN = "2026-10-13";
const RECORDED_CHECK_OUT = "2026-10-14";
const RECORDED_TBO_URL = "https://api.tbotechnology.in/TBOHolidays_HotelAPI";

type Messages = Record<string, unknown>;

function catalog(locale: string): Messages {
  return JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL(`../../apps/dashboard/src/messages/${locale}.json`, import.meta.url),
      ),
      "utf8",
    ),
  ) as Messages;
}

function message(messages: Messages, path: string): string {
  let node: unknown = messages;
  for (const key of path.split(".")) {
    node = (node as Record<string, unknown>)[key];
  }
  if (typeof node !== "string") throw new Error(`no message at ${path}`);
  return node;
}

test.describe.configure({ mode: "serial" });

test.describe("internal dashboard", () => {
  let locale: string;
  let messages: Messages;
  let dir: string;

  // Playwright demands a destructured first arg; browserName is unused.
  test.beforeAll(({ browserName: _browserName }, testInfo) => {
    locale = testInfo.project.name;
    messages = catalog(locale);
    dir = locale === "ar" ? "rtl" : "ltr";
    mkdirSync(fileURLToPath(new URL(`../screenshots/${locale}`, import.meta.url)), {
      recursive: true,
    });
  });

  test.beforeEach(async ({ context }) => {
    await context.addCookies([
      { name: "jenova_locale", value: locale, url: "http://127.0.0.1:3800" },
    ]);
  });

  async function shot(page: Page, name: string): Promise<void> {
    await page.screenshot({
      path: fileURLToPath(new URL(`../screenshots/${locale}/${name}.png`, import.meta.url)),
      fullPage: true,
    });
  }

  async function login(page: Page): Promise<void> {
    await page.goto("/login");
    await page.locator('[data-testid="login-email"] input').fill(state.adminEmail);
    await page.locator('[data-testid="login-password"] input').fill(state.adminPassword);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL("**/workspace/bookings");
  }

  test("login page renders direction-correct and signs in", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL("**/login");
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByText(message(messages, "login.subtitle"))).toBeVisible();
    await shot(page, "01-login");

    // A wrong password fails with the localized generic message.
    await page.locator('[data-testid="login-email"] input').fill(state.adminEmail);
    await page.locator('[data-testid="login-password"] input').fill("wrong-password");
    await page.locator('[data-testid="login-submit"]').click();
    await expect(page.getByText(message(messages, "login.errors.unauthorized"))).toBeVisible();

    await page.locator('[data-testid="login-password"] input').fill(state.adminPassword);
    await page.locator('[data-testid="login-submit"]').click();
    await page.waitForURL("**/workspace/bookings");
    await expect(page.locator("html")).toHaveAttribute("dir", dir);
  });

  test("navigation shows ONLY entitled apps; uninstalled routes are forbidden", async ({
    page,
  }) => {
    await login(page);
    // Core workspace + settings + the ONE installed app (b2b).
    await expect(page.locator('a[href="/workspace/queue"]').first()).toBeVisible();
    await expect(page.locator('a[href="/apps/b2b"]').first()).toBeVisible();
    for (const key of ["finance", "corporate", "crm", "desk", "storefront"]) {
      await expect(page.locator(`a[href="/apps/${key}"]`)).toHaveCount(0);
    }
    await shot(page, "02-shell-nav");

    // Route guard: an uninstalled app's URL renders the ForbiddenState.
    await page.goto("/apps/finance");
    await expect(page.getByText(message(messages, "forbidden.title"))).toBeVisible();
    await shot(page, "03-forbidden");

    // The installed app resolves to its section page.
    await page.goto("/apps/b2b");
    await expect(page.getByText(message(messages, "appSection.placeholder"))).toBeVisible();
  });

  test("settings: invite a user and flip the enforce-2FA policy", async ({ page }) => {
    await login(page);
    await page.goto("/settings/users");
    await expect(page.getByText(state.adminEmail)).toBeVisible();

    await page.locator('[data-testid="invite-user"]').click();
    await page.locator('[data-testid="invite-name"] input').fill(`Ops ${locale}`);
    await page.locator('[data-testid="invite-email"] input').fill(`ops-${locale}@e2e-tenant.local`);
    await page.locator('[data-testid="invite-submit"]').click();
    const initialPassword = page.locator('[data-testid="initial-password"]');
    await expect(initialPassword).toBeVisible();
    await expect(initialPassword).not.toHaveText("");
    await shot(page, "04-invite-initial-password");
    await page.getByRole("button", { name: message(messages, "settings.users.done") }).click();
    // Wait for the modal to unmount fully — its closing backdrop otherwise
    // intercepts the next click.
    await expect(page.locator(".MuiDialog-root")).toHaveCount(0);
    await expect(page.getByText(`ops-${locale}@e2e-tenant.local`)).toBeVisible();

    const enforceSwitch = page.locator('[data-testid="enforce-totp"] input');
    await enforceSwitch.click();
    await expect(
      page.getByText(message(messages, "settings.users.policySaved")).first(),
    ).toBeVisible();
    await expect(enforceSwitch).toBeChecked();
    await enforceSwitch.click();
    await expect(enforceSwitch).not.toBeChecked();
  });

  test("settings: save supplier credentials write-only and test the connection", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/settings/suppliers");
    await expect(page.locator('[data-testid="supplier-tbo"]')).toBeVisible();

    await page.locator('[data-testid="secret-tbo-apiUrl"] input').fill(RECORDED_TBO_URL);
    await page.locator('[data-testid="secret-tbo-username"] input').fill("replay");
    await page.locator('[data-testid="secret-tbo-password"] input').fill("replay");
    await page.locator('[data-testid="save-tbo-sandbox"]').click();
    await expect(
      page.getByText(message(messages, "settings.suppliers.configured")).first(),
    ).toBeVisible();
    // Write-only: after save the fields are empty again.
    await expect(page.locator('[data-testid="secret-tbo-password"] input')).toHaveValue("");

    // test-connection replays the committed CountryList recording through
    // the REAL adapter and reports ok.
    await page.locator('[data-testid="test-tbo-sandbox"]').click();
    await expect(page.locator('[data-testid="test-ok"]')).toBeVisible({ timeout: 30_000 });
    await shot(page, "05-supplier-test-ok");
  });

  test("settings: branding saves the legal name", async ({ page }) => {
    await login(page);
    await page.goto("/settings/branding");
    const legalName = locale === "ar" ? "شركة جينوفا التجريبية للسفر" : "Jenova E2E Travel Co";
    await page.locator('[data-testid="legal-name"] input').fill(legalName);
    await page.locator('[data-testid="save-branding"]').click();
    await expect(page.getByText(message(messages, "settings.branding.saved")).first()).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-testid="legal-name"] input')).toHaveValue(legalName);
    await shot(page, "06-branding");
  });

  test("bookings: seeded recorded booking lists, filters and opens with audit + ledger", async ({
    page,
  }) => {
    await login(page);
    await expect(page.getByText(/E2E-CONFIRMED-/).first()).toBeVisible();
    await shot(page, "07-bookings-list");

    // Filter to a state with no rows: the localized empty state renders.
    await page.goto("/workspace/bookings?state=completed");
    await expect(
      page.getByText(message(messages, "workspace.bookings.empty.title")),
    ).toBeVisible();

    // Open the confirmed booking's detail.
    await page.goto("/workspace/bookings?state=confirmed");
    await page.getByText(/E2E-CONFIRMED-/).first().click();
    await page.waitForURL("**/workspace/bookings/*");
    await expect(page.locator('[data-testid="booking-item"]').first()).toBeVisible();
    // State history from the append-only audit trail…
    const history = page.locator('[data-testid="state-history"]');
    await expect(history.getByText("booking.created")).toBeVisible();
    await expect(history.getByText("booking_item.transition").first()).toBeVisible();
    // …and the ledger panel is a ledger read with real account codes.
    const ledger = page.locator('[data-testid="ledger-panel"]');
    await expect(ledger.getByText(/sales\.[A-Z]{3}/).first()).toBeVisible();
    await shot(page, "08-booking-detail");
  });

  test("queue: escalated item shows reason + age; retry-poll settles it via replay", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/workspace/queue");
    const item = page.locator('[data-testid="escalation-item"]').first();
    await expect(item).toBeVisible();
    await expect(item.getByText(/manual intervention required/)).toBeVisible();
    await expect(item.getByText(message(messages, "workspace.queue.age"))).toBeVisible();
    await shot(page, "09-queue");

    // ONE forced poll through the runner: the replayed BookingDetail says
    // Confirmed, the item settles and the escalation auto-resolves.
    await item.locator('[data-testid="retry-poll"]').click();
    await expect(
      page.getByText(message(messages, "workspace.queue.outcomes.transitioned_confirmed")),
    ).toBeVisible({ timeout: 30_000 });
    await shot(page, "10-queue-after-retry");
  });

  test("search console streams replayed availability progressively", async ({ page }) => {
    await login(page);
    await page.goto("/workspace/search");
    await page.locator('[data-testid="property-ids"] textarea').first().fill(RECORDED_PROPERTY_IDS);
    await page.locator('[data-testid="check-in"] input').fill(RECORDED_CHECK_IN);
    await page.locator('[data-testid="check-out"] input').fill(RECORDED_CHECK_OUT);
    await page.locator('[data-testid="run-search"]').click();

    // The tbo lane reports results and offers render progressively with
    // server-priced Money (rule 8 — prices only ever come from the api).
    await expect(page.locator('[data-lane-status="results"]')).toBeVisible({ timeout: 45_000 });
    const offers = page.locator('[data-testid="offer-row"]');
    await expect(offers.first()).toBeVisible();
    expect(await offers.count()).toBeGreaterThan(0);
    await shot(page, "11-search-results");
  });

  test("logout revokes the session and returns to login", async ({ page }) => {
    await login(page);
    await page.locator('[data-testid="user-menu"]').click();
    await page.locator('[data-testid="logout"]').click();
    await page.waitForURL("**/login");
    // The cookie is gone: a protected route bounces straight back.
    await page.goto("/workspace/bookings");
    await page.waitForURL("**/login");
    await shot(page, "12-logged-out");
  });
});

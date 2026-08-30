/**
 * @jenova/db/testing — the integration-test harness, exported for the other
 * workspaces' service tests (apps/api offer store, booking engine, …) so
 * every suite provisions throwaway databases the exact same way instead of
 * growing private copies of this mechanism.
 *
 * Test-only: nothing here may be imported from runtime code, and the same
 * rules apply as inside this package — NO fabricated business data; tests
 * insert only the minimal structural rows needed to prove mechanisms.
 */

export {
  TEST_PG_URL,
  createTestPlatform,
  expectDbRejection,
  pgAvailable,
  type TestPlatform,
} from "./integration/helpers";

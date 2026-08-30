// @jenova/supplier-sdk/testing — vitest-facing contract harness. Kept out of
// the runtime entry point so importing the sdk never pulls in vitest.
export {
  assertHotelOffer,
  assertHotelBookingRecord,
  expectSupplierErrorKind,
  type HotelHappyPathScenario,
  type HotelErrorScenario,
  type HotelAdapterContractOptions,
  describeHotelAdapterContract,
} from "./harness";

export {
  CERTIFICATION_CHECK_STATUSES,
  type CertificationCheckStatus,
  type CertificationCheck,
  type CertificationRunInfo,
  formatCertificationReport,
} from "./report";

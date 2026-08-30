/**
 * @jenova/db — control-plane + tenant schemas, per-tenant provisioning, the
 * tenant connection resolver (the ONLY door to tenant data), and the fan-out
 * migration runner.
 *
 * Deliberately NOT exported: raw postgres pools, connection factories, or the
 * internal migration engine — misuse of tenancy must be impossible, not
 * discouraged (CLAUDE.md rule 1).
 */

export {
  connectControlPlane,
  type ConnectControlPlaneOptions,
  type ControlPlaneClient,
  type ControlPlaneDb,
} from "./control-plane/client";

export {
  HOSTING_TIERS,
  type HostingTier,
  CERTIFICATION_STATUSES,
  type CertificationStatus,
  tenants,
  appInstallations,
  platformUsers,
  supplierCatalogEntries,
} from "./control-plane/schema";

export {
  SUPPLIER_ENVIRONMENTS,
  type SupplierEnvironment,
  AGENCY_STATUSES,
  type AgencyStatus,
  MARKUP_VALUE_TYPES,
  type MarkupValueType,
  PAYMENT_STATES,
  type PaymentState,
  LEDGER_ACCOUNT_TYPES,
  type LedgerAccountType,
  AUDIT_ACTOR_TYPES,
  type AuditActorType,
  type OfferRoomOccupancy,
  supplierAccounts,
  agencies,
  agencyUsers,
  markupRules,
  offers,
  bookings,
  bookingItems,
  ledgerAccounts,
  journalEntries,
  auditEvents,
} from "./tenant/schema";

export {
  createTenantDatabase,
  tenantDbName,
  type CreateTenantDatabaseOptions,
  type ProvisionResult,
} from "./provisioning";

export {
  createTenantDbResolver,
  type TenantDb,
  type TenantDbResolver,
  type TenantDbResolverOptions,
} from "./resolver";

export {
  runFanout,
  type DatabaseFanoutStatus,
  type FanoutMode,
  type FanoutOptions,
  type FanoutReport,
  type TenantFanoutStatus,
} from "./fanout";

export {
  TenantNotFoundError,
  TenantNotProvisionedError,
  TenantAlreadyProvisionedError,
  InvalidTenantSlugError,
  MigrationChecksumError,
  MigrationSequenceError,
} from "./errors";

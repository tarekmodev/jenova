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
  TenantNotFoundError,
  TenantNotProvisionedError,
  TenantAlreadyProvisionedError,
  InvalidTenantSlugError,
  MigrationChecksumError,
  MigrationSequenceError,
} from "./errors";

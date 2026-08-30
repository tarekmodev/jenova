/**
 * Error taxonomy for tenancy plumbing (provisioning, resolution, migrations).
 * All are programmer/operator-facing — none of these ever carry supplier or
 * booking semantics (that is the domain package's SupplierError).
 */

export class TenantNotFoundError extends Error {
  constructor(readonly ref: string) {
    super(`tenant not found: ${ref}`);
    this.name = "TenantNotFoundError";
  }
}

export class TenantNotProvisionedError extends Error {
  constructor(readonly ref: string) {
    super(`tenant has no provisioned database yet: ${ref}`);
    this.name = "TenantNotProvisionedError";
  }
}

export class TenantAlreadyProvisionedError extends Error {
  constructor(
    readonly ref: string,
    readonly dbName: string,
  ) {
    super(`tenant ${ref} already has database ${dbName}`);
    this.name = "TenantAlreadyProvisionedError";
  }
}

export class InvalidTenantSlugError extends Error {
  constructor(readonly slug: string) {
    super(
      `tenant slug must be lowercase [a-z][a-z0-9_]* (2-46 chars) so it can form a safe database identifier, got ${JSON.stringify(slug)}`,
    );
    this.name = "InvalidTenantSlugError";
  }
}

/** An already-applied migration file was edited — migration files are immutable. */
export class MigrationChecksumError extends Error {
  constructor(readonly migrationName: string) {
    super(
      `migration ${migrationName} was modified after being applied — migration files are immutable; ship a new migration instead`,
    );
    this.name = "MigrationChecksumError";
  }
}

export class MigrationSequenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationSequenceError";
  }
}

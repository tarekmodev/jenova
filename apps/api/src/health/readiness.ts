/**
 * Pluggable readiness checks (issue #30).
 *
 * /health is pure liveness and touches nothing; /ready runs every registered
 * check. M0 registers an EMPTY set — control-plane DB and redis checks join
 * when their clients are wired (#42 follow-up). A check passes by resolving
 * and fails by rejecting.
 */

export interface ReadinessCheck {
  readonly name: string;
  check(): Promise<void>;
}

/** Nest injection token for the readonly ReadinessCheck[] the api runs. */
export const READINESS_CHECKS = Symbol("jenova.api.readinessChecks");

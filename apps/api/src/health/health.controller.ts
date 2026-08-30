import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { READINESS_CHECKS, type ReadinessCheck } from "./readiness";

@ApiTags("platform")
@Controller()
export class HealthController {
  constructor(
    @Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[],
  ) {}

  /** Liveness: the process is up. Touches NO dependencies, by contract. */
  @Get("health")
  @ApiOperation({ summary: "Liveness probe (no dependencies)" })
  health(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: every registered check passes (empty set at M0). */
  @Get("ready")
  @ApiOperation({ summary: "Readiness probe (runs pluggable checks)" })
  async ready(): Promise<{ status: "ready"; checks: readonly string[] }> {
    const results = await Promise.allSettled(this.checks.map((c) => c.check()));
    const failed = this.checks.filter((_, i) => results[i]?.status === "rejected");
    if (failed.length > 0) {
      throw new ServiceUnavailableException(
        `readiness checks failed: ${failed.map((c) => c.name).join(", ")}`,
      );
    }
    return { status: "ready", checks: this.checks.map((c) => c.name) };
  }
}

/**
 * Thin Nest binding of the gateway chain (issue #31). Registered as a global
 * guard: guards are the earliest hook with access to route metadata, which
 * the entitlement stage needs (@RequiresApp). All logic lives in the
 * framework-free stages; this class only extracts GatewayRequestInfo.
 */

import { Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AppKey } from "@jenova/domain";
import { REQUIRES_APP_METADATA, SKIP_GATEWAY_METADATA } from "./decorators";
import { ApiHttpError } from "./errors";
import { getRequestContext, type RequestContextCarrier } from "./request-context";
import { GATEWAY_PIPELINE, GatewayPipeline } from "./stages";

function headerValue(req: Request, name: string): string | null {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

@Injectable()
export class GatewayGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(GATEWAY_PIPELINE) private readonly pipeline: GatewayPipeline,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const targets = [executionContext.getHandler(), executionContext.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_GATEWAY_METADATA, targets) === true) {
      return true;
    }

    const req = executionContext
      .switchToHttp()
      .getRequest<Request & RequestContextCarrier>();
    const context = getRequestContext(req);
    if (context === null) {
      // configureApp mounts the request-context middleware ahead of routing;
      // a missing context means the app was assembled without it.
      throw ApiHttpError.internal("request context middleware is not mounted");
    }

    await this.pipeline.run(context, {
      host: headerValue(req, "host"),
      authorization: headerValue(req, "authorization"),
      requiredApp:
        this.reflector.getAllAndOverride<AppKey>(REQUIRES_APP_METADATA, targets) ?? null,
    });
    return true;
  }
}

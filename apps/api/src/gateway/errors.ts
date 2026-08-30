/**
 * Standard JSON error envelope (issue #31): every error the api returns is
 * `{ error: { code, message, requestId } }` — gateway rejections, engine
 * errors, and framework exceptions alike.
 */

import { HttpException, HttpStatus } from "@nestjs/common";

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}

/** An HttpException carrying the machine-readable envelope code. */
export class ApiHttpError extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
  ) {
    super(message, status);
    this.name = "ApiHttpError";
  }

  static tenantNotFound(host: string | null): ApiHttpError {
    return new ApiHttpError(
      "tenant_not_found",
      host === null
        ? "no Host header was sent, so no tenant can be resolved"
        : `no tenant is bound to host ${JSON.stringify(host)}`,
      HttpStatus.NOT_FOUND,
    );
  }

  static appNotInstalled(appKey: string): ApiHttpError {
    return new ApiHttpError(
      "app_not_installed",
      `the ${appKey} app is not installed for this tenant`,
      HttpStatus.FORBIDDEN,
    );
  }

  static internal(message: string): ApiHttpError {
    return new ApiHttpError("internal_error", message, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  422: "unprocessable_entity",
  429: "rate_limited",
  500: "internal_error",
  503: "service_unavailable",
};

/** Envelope code for a framework HttpException that carries none of its own. */
export function codeForStatus(status: number): string {
  return CODE_BY_STATUS[status] ?? `http_${String(status)}`;
}

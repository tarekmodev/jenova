/**
 * Global exception filter shaping EVERY error response into the standard
 * envelope { error: { code, message, requestId } } (issue #31).
 */

import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { ApiHttpError, codeForStatus, type ErrorEnvelope } from "./errors";
import { getRequestContext, type RequestContextCarrier } from "./request-context";

@Catch()
export class ErrorEnvelopeFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & RequestContextCarrier>();
    const res = http.getResponse<Response>();
    const requestId = getRequestContext(req)?.requestId ?? "";

    let status = 500;
    let code = "internal_error";
    // Unexpected errors never leak their message to the wire.
    let message = "internal error";
    if (exception instanceof ApiHttpError) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = codeForStatus(status);
      message = exception.message;
    }

    const envelope: ErrorEnvelope = { error: { code, message, requestId } };
    res.status(status).json(envelope);
  }
}

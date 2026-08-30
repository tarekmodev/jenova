/**
 * Request-id middleware (issue #31) + the OTel hook point's call site
 * (issue #30). Mounted FIRST via app.use in configureApp, ahead of routing,
 * so every response — including gateway rejections and 404s — carries a
 * request id and a RequestContext exists before any stage runs.
 */

import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { HttpServerHooks } from "../observability/instrumentation";
import {
  attachRequestContext,
  createRequestContext,
  type RequestContextCarrier,
} from "./request-context";

export const REQUEST_ID_HEADER = "x-request-id";

export function requestContextMiddleware(hooks: HttpServerHooks) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Always server-generated — an attacker-chosen id must never thread
    // through logs, audit events, and support tickets.
    const requestId = randomUUID();
    attachRequestContext(req as Request & RequestContextCarrier, createRequestContext(requestId));
    res.setHeader(REQUEST_ID_HEADER, requestId);

    const info = { requestId, method: req.method, path: req.path };
    const startedAt = process.hrtime.bigint();
    hooks.onRequest?.(info);
    res.on("finish", () => {
      hooks.onResponse?.({
        ...info,
        statusCode: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
      });
    });
    next();
  };
}

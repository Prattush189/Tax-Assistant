/**
 * Express 4 only catches errors THROWN synchronously by a handler. Most of
 * our routes are `async`, so a throw inside one (e.g. `.toLowerCase()` on a
 * number from a malformed body) became an unhandled promise rejection —
 * which on Node ≥ 15 kills the process, taking every user's in-flight
 * request and background job with it.
 *
 * This patches Express's Layer so a rejected promise from any route or
 * middleware is passed to `next(err)` like a sync throw would be, and the
 * JSON error handler below answers it. Same approach as the
 * `express-async-errors` package; done inline to avoid a dependency that
 * reaches into the same private file. Express 5 does this natively — drop
 * this file when upgrading.
 */
import { createRequire } from 'module';
import type { ErrorRequestHandler } from 'express';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Layer = require('express/lib/router/layer.js');

type Next = (err?: unknown) => void;
const original = Layer.prototype.handle_request;

Layer.prototype.handle_request = function handleRequest(this: { handle: (...a: unknown[]) => unknown }, req: unknown, res: unknown, next: Next) {
  const fn = this.handle;
  // 4-arg functions are error handlers; Express skips them here.
  if (fn.length > 3) return original.call(this, req, res, next);
  try {
    const ret = fn(req, res, next) as { catch?: (cb: (e: unknown) => void) => unknown } | undefined;
    if (ret && typeof ret.catch === 'function') {
      ret.catch((err: unknown) => next(err ?? new Error('Route rejected without an error')));
    }
  } catch (err) {
    next(err);
  }
};

/** Last-resort error handler: logs, and answers JSON instead of Express's
 *  HTML stack page. A response already streaming (SSE) is just closed. */
export const jsonErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = Number((err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode) || 500;
  if (status >= 500) console.error(`[API] Unhandled error on ${req.method} ${req.originalUrl}:`, err);
  if (res.headersSent) {
    res.end();
    return;
  }
  const clientError = status >= 400 && status < 500;
  res.status(clientError ? status : 500).json({
    error: clientError && (err as { expose?: boolean })?.expose ? (err as Error).message : clientError ? 'Bad request' : 'Something went wrong. Please try again.',
  });
};

/** Promises outside any request (background jobs, timers) have no `next`.
 *  Log them rather than letting Node exit; an uncaught *exception* still
 *  crashes (state may be corrupt) and pm2 restarts the process. */
export function installProcessSafetyNet(): void {
  process.on('unhandledRejection', (reason) => {
    console.error('[API] Unhandled promise rejection (process kept alive):', reason);
  });
}

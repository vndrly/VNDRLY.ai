import type { Response } from "express";

export interface ApiErrorPayload {
  error: string;
  message: string;
  code: string;
  [key: string]: unknown;
}

/**
 * Build a standard API error payload `{ error, message, code, ...extras }`.
 *
 * `code` is the dotted lowercase identifier (e.g. `comment.not_found`)
 * the EN/ES locale catalogs translate via `errors.<code>`. `message`
 * is the English fallback used when the client can't resolve the code.
 * Both `error` and `message` are emitted as aliases so legacy clients
 * that read `error` and newer clients that read `message` both work.
 */
export function apiError(
  code: string,
  message: string,
  extras?: Record<string, unknown>,
): ApiErrorPayload {
  return {
    error: message,
    message,
    code,
    ...(extras ?? {}),
  };
}

/**
 * Send a standard API error response. Equivalent to
 * `res.status(status).json(apiError(code, message, extras))`.
 */
export function sendApiError(
  res: Response,
  status: number,
  code: string,
  message: string,
  extras?: Record<string, unknown>,
): Response {
  return res.status(status).json(apiError(code, message, extras));
}

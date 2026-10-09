import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { ApiError, ApiErrorCode } from '@textauth/shared';
import { safeEqual } from './hash.js';
import { getAppSecret } from './secrets.js';

export type HttpEvent = APIGatewayProxyEventV2;
export type HttpResult = APIGatewayProxyStructuredResultV2;
export type HttpHandler = (event: HttpEvent) => Promise<HttpResult>;

export function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): HttpResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
    body: JSON.stringify(body),
  };
}

export function apiError(statusCode: number, error: ApiErrorCode, message: string): HttpResult {
  return json(statusCode, { error, message } satisfies ApiError);
}

export function redirect(location: string): HttpResult {
  return { statusCode: 302, headers: { location, 'cache-control': 'no-store' } };
}

/** Placeholder for endpoints that are designed (see docs/architecture.md) but not built yet. */
export const notImplemented: HttpHandler = async () =>
  apiError(501, 'not_implemented', 'This endpoint is not implemented yet');

/**
 * Wraps every Lambda handler: rejects requests that didn't come through CloudFront (and so
 * skipped WAF's rate limits), and turns unexpected exceptions into a 500 without leaking them.
 */
export function httpHandler(handler: HttpHandler): HttpHandler {
  return async (event) => {
    try {
      const { originVerifySecret } = await getAppSecret();
      const originHeader = event.headers['x-origin-verify'];
      if (originHeader === undefined || !safeEqual(originHeader, originVerifySecret)) {
        return apiError(403, 'invalid_request', 'Forbidden');
      }
      return await handler(event);
    } catch (err) {
      console.error(err);
      return apiError(500, 'internal_error', 'Something went wrong');
    }
  };
}

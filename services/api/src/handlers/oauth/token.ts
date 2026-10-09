import { createHash } from 'node:crypto';
import { safeEqual } from '../../lib/hash.js';
import { httpHandler, json, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { parseFormBody, stringField } from '../../lib/request.js';
import { getAppSecret } from '../../lib/secrets.js';
import { ACCESS_TOKEN_TTL_SECONDS, createAccessToken } from '../../store/access-tokens.js';
import { consumeAuthorizationCode } from '../../store/authorization-codes.js';

/**
 * POST /oauth/token — Auth0 exchanges the authorization code (server-to-server).
 *
 * Authenticates the client (HTTP Basic or client_id/client_secret in the body), redeems the code
 * exactly once, checks redirect_uri and the PKCE verifier against what /oauth/authorize saw, and
 * returns an opaque bearer token for /oauth/userinfo. Errors follow RFC 6749 §5.2.
 */
export async function token(event: HttpEvent): Promise<HttpResult> {
  const body = parseFormBody(event) ?? {};
  const client = clientCredentials(event, body);
  const { auth0ClientId, auth0ClientSecret } = await getAppSecret();
  if (!client || !safeEqual(client.id, auth0ClientId) || !safeEqual(client.secret, auth0ClientSecret)) {
    return oauthError(401, 'invalid_client', 'Client authentication failed', {
      'www-authenticate': 'Basic realm="textauth"',
    });
  }

  if (body.grant_type !== 'authorization_code') {
    return oauthError(400, 'unsupported_grant_type', 'Only authorization_code is supported');
  }
  const code = stringField(body, 'code', 512);
  if (!code) {
    return oauthError(400, 'invalid_request', 'code is required');
  }

  const grant = await consumeAuthorizationCode(code);
  if (!grant || grant.clientId !== client.id) {
    return oauthError(400, 'invalid_grant', 'The code is invalid, expired or already used');
  }
  if (body.redirect_uri !== grant.redirectUri) {
    return oauthError(400, 'invalid_grant', 'redirect_uri does not match the authorization request');
  }
  if (grant.codeChallenge) {
    const verifier = stringField(body, 'code_verifier', 128);
    if (!verifier || !safeEqual(createHash('sha256').update(verifier).digest('base64url'), grant.codeChallenge)) {
      return oauthError(400, 'invalid_grant', 'code_verifier does not match the code_challenge');
    }
  }

  const accessToken = await createAccessToken({ userId: grant.userId, clientId: grant.clientId, scope: grant.scope });
  return json(
    200,
    {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      ...(grant.scope ? { scope: grant.scope } : {}),
    },
    { pragma: 'no-cache' },
  );
}

export const handler = httpHandler(token);

function clientCredentials(
  event: HttpEvent,
  body: Record<string, unknown>,
): { id: string; secret: string } | undefined {
  const authorization = event.headers.authorization;
  if (authorization?.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return undefined;
    // RFC 6749 §2.3.1: both parts are form-urlencoded before being joined.
    try {
      return {
        id: decodeURIComponent(decoded.slice(0, separator)),
        secret: decodeURIComponent(decoded.slice(separator + 1)),
      };
    } catch {
      return undefined;
    }
  }
  const id = stringField(body, 'client_id');
  const secret = stringField(body, 'client_secret');
  return id && secret ? { id, secret } : undefined;
}

function oauthError(
  statusCode: number,
  error: string,
  description: string,
  headers: Record<string, string> = {},
): HttpResult {
  return json(statusCode, { error, error_description: description }, { pragma: 'no-cache', ...headers });
}

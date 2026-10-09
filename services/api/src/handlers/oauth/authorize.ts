import { getConfig } from '../../lib/config.js';
import { httpHandler, redirect, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { getAppSecret } from '../../lib/secrets.js';
import { createLoginTransaction } from '../../store/login-transactions.js';

/**
 * GET /oauth/authorize — Auth0 sends the user here when they pick "Login with Your Phone".
 *
 * Validates the OAuth request, stores it as a login transaction and sends the user to the login
 * UI with the transaction id. Per RFC 6749 §4.1.2.1, a bad client_id or redirect_uri gets an
 * error page rather than a redirect, so we never send anyone to an unvetted URL; every other
 * error is reported to the (now trusted) redirect_uri.
 */
export async function authorize(event: HttpEvent): Promise<HttpResult> {
  const params = event.queryStringParameters ?? {};
  const config = getConfig();
  const { auth0ClientId } = await getAppSecret();

  const redirectUri = params.redirect_uri;
  if (!redirectUri || !config.allowedRedirectUris.includes(redirectUri)) {
    return errorPage('The redirect_uri is missing or not allowed.');
  }
  if (params.client_id !== auth0ClientId) {
    return errorPage('The client_id is missing or unknown.');
  }

  const state = params.state;
  const fail = (error: string, description: string) =>
    redirect(withQuery(redirectUri, { error, error_description: description, state }));

  if (params.response_type !== 'code') {
    return fail('unsupported_response_type', 'Only response_type=code is supported');
  }
  // Auth0 always sends state; requiring it keeps CSRF protection from being optional.
  if (!state) {
    return fail('invalid_request', 'state is required');
  }
  if (params.code_challenge && params.code_challenge_method !== 'S256') {
    return fail('invalid_request', 'Only the S256 code_challenge_method is supported');
  }

  const tx = await createLoginTransaction({
    clientId: auth0ClientId,
    redirectUri,
    state,
    scope: params.scope,
    codeChallenge: params.code_challenge,
  });

  return redirect(withQuery(`${config.publicBaseUrl}/`, { tx: tx.id }));
}

export const handler = httpHandler(authorize);

function withQuery(url: string, query: Record<string, string | undefined>): string {
  const result = new URL(url);
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) result.searchParams.set(name, value);
  }
  return result.toString();
}

function errorPage(message: string): HttpResult {
  return {
    statusCode: 400,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
    body: `Login request rejected: ${message}`,
  };
}

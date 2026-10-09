import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * GET /oauth/authorize — Auth0 sends the user here when they pick "Login with Your Phone".
 *
 * TODO: validate response_type=code, client_id and redirect_uri (must be in
 * ALLOWED_REDIRECT_URIS), store a login transaction (client/redirect/state/PKCE challenge,
 * 15 min TTL) and 302 to the login UI at `/?tx=<id>`. Invalid redirect_uri must NOT redirect.
 */
export const handler = httpHandler(notImplemented);

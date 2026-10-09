import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * POST /oauth/token — Auth0 exchanges the authorization code (server-to-server).
 *
 * TODO: authenticate the client (client_secret_post or basic), consume the code exactly once
 * (check redirect_uri, PKCE verifier if one was sent), return an opaque bearer access token.
 */
export const handler = httpHandler(notImplemented);

import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * POST /api/email/verify — EmailVerifyRequest -> NextStep (done).
 *
 * TODO: check the code, save the email as verified, create the authorization code and return
 * Auth0's redirect_uri with code + state.
 */
export const handler = httpHandler(notImplemented);

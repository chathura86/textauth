import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * GET /oauth/userinfo — Auth0's Fetch User Profile script calls this with the access token.
 *
 * TODO: return { sub, email, email_verified, phone_number, phone_number_verified }.
 */
export const handler = httpHandler(notImplemented);

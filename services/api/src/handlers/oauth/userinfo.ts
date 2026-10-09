import { httpHandler, json, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { getAccessToken } from '../../store/access-tokens.js';
import { findUserById } from '../../store/users.js';

/**
 * GET /oauth/userinfo — Auth0's Fetch User Profile script calls this with the access token.
 *
 * Both the phone and the email are always verified: the phone by SMS code, the email either by
 * email code or because we generated it.
 */
export async function userinfo(event: HttpEvent): Promise<HttpResult> {
  const authorization = event.headers.authorization;
  const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : undefined;
  const grant = accessToken ? await getAccessToken(accessToken) : undefined;
  const user = grant ? await findUserById(grant.userId) : undefined;
  if (!user) {
    return json(
      401,
      { error: 'invalid_token', error_description: 'The access token is invalid or expired' },
      { 'www-authenticate': 'Bearer error="invalid_token"' },
    );
  }

  return json(200, {
    sub: user.id,
    email: user.email,
    email_verified: true,
    phone_number: user.phone,
    phone_number_verified: true,
  });
}

export const handler = httpHandler(userinfo);

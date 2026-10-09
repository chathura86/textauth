import { createAuthorizationCode } from '../store/authorization-codes.js';
import { advanceLoginTransaction, type LoginStep, type LoginTransaction } from '../store/login-transactions.js';

/**
 * Ends a login: issues the authorization code for `userId` and returns the URL that sends the
 * browser back to Auth0. The transaction moves to 'done' first, so it can only finish once.
 */
export async function completeLogin(tx: LoginTransaction, from: LoginStep, userId: string): Promise<string> {
  await advanceLoginTransaction(tx.id, from, 'done', { userId });

  const code = await createAuthorizationCode({
    userId,
    clientId: tx.oauth.clientId,
    redirectUri: tx.oauth.redirectUri,
    scope: tx.oauth.scope,
    codeChallenge: tx.oauth.codeChallenge,
  });

  const url = new URL(tx.oauth.redirectUri);
  url.searchParams.set('code', code);
  url.searchParams.set('state', tx.oauth.state);
  return url.toString();
}

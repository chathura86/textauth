import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { NextStep } from '@textauth/shared';
import type { LoginStep, LoginTransaction } from '../store/login-transactions.js';
import { createUser, UserConflictError, type User } from '../store/users.js';
import { completeLogin } from './complete-login.js';
import { apiError, json, type HttpResult } from './http.js';

/**
 * Creates the account for a new user whose phone is verified (`tx.phone`) and finishes the
 * login. Shared by email-verify (their own email) and email-skip (a synthetic one).
 *
 * `email` may be a function so email-skip can retry with a fresh synthetic address in the
 * (very unlikely) event of a collision.
 */
export async function createAccountAndCompleteLogin(
  tx: LoginTransaction,
  from: LoginStep,
  email: string | (() => string),
  emailSource: User['emailSource'],
): Promise<HttpResult> {
  if (!tx.phone) {
    return apiError(400, 'invalid_transaction', 'This login has expired. Please start again.');
  }

  let user: User | undefined;
  for (let attempt = 0; !user; attempt++) {
    try {
      user = await createUser({
        phone: tx.phone,
        email: typeof email === 'function' ? email() : email,
        emailSource,
      });
    } catch (err) {
      if (!(err instanceof UserConflictError)) throw err;
      if (err.field === 'email' && typeof email === 'function' && attempt < 2) continue;
      if (err.field === 'email') {
        return apiError(409, 'email_in_use', 'This email is already used by another account. Use a different one, or skip.');
      }
      // Someone signed up with this phone since it was verified — a parallel login.
      return apiError(409, 'invalid_transaction', 'This login was already completed. Please start again.');
    }
  }

  try {
    const redirectUrl = await completeLogin(tx, from, user.id);
    return json(200, { step: 'done', redirectUrl } satisfies NextStep);
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      return apiError(409, 'invalid_transaction', 'This login was already completed.');
    }
    throw err;
  }
}

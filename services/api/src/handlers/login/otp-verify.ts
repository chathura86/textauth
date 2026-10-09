import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { NextStep } from '@textauth/shared';
import { completeLogin } from '../../lib/complete-login.js';
import { apiError, httpHandler, json, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { checkCode, codeError } from '../../lib/one-time-codes.js';
import { parseJsonBody, stringField } from '../../lib/request.js';
import { advanceLoginTransaction, getLoginTransaction } from '../../store/login-transactions.js';
import { findUserByPhone } from '../../store/users.js';

/**
 * POST /api/otp/verify — OtpVerifyRequest -> NextStep.
 *
 * A returning user is done here (they already have an email); a new user moves on to the
 * email step, and their account is created there.
 */
export async function otpVerify(event: HttpEvent): Promise<HttpResult> {
  const body = parseJsonBody(event);
  const txId = body && stringField(body, 'tx');
  const code = body && stringField(body, 'code', 16)?.replace(/\s/g, '');
  if (!txId || !code) {
    return apiError(400, 'invalid_request', 'tx and code are required');
  }

  const tx = await getLoginTransaction(txId);
  if (!tx) {
    return codeError('no_code');
  }
  const check = await checkCode(tx, 'otp', code);
  if (check.result !== 'ok') {
    return codeError(check.result);
  }

  try {
    const user = await findUserByPhone(check.target);
    if (user) {
      const redirectUrl = await completeLogin(tx, 'otp', user.id);
      return json(200, { step: 'done', redirectUrl } satisfies NextStep);
    }
    await advanceLoginTransaction(tx.id, 'otp', 'email');
    return json(200, { step: 'email' } satisfies NextStep);
  } catch (err) {
    // Another request with the same code got there first.
    if (err instanceof ConditionalCheckFailedException) {
      return apiError(409, 'invalid_transaction', 'This login was already completed.');
    }
    throw err;
  }
}

export const handler = httpHandler(otpVerify);

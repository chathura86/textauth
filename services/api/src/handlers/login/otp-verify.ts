import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { NextStep } from '@textauth/shared';
import { completeLogin } from '../../lib/complete-login.js';
import { hmac, safeEqual } from '../../lib/hash.js';
import { apiError, httpHandler, json, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { parseJsonBody, stringField } from '../../lib/request.js';
import { nowSeconds } from '../../store/db.js';
import {
  advanceLoginTransaction,
  getLoginTransaction,
  recordOtpAttempt,
} from '../../store/login-transactions.js';
import { findUserByPhone } from '../../store/users.js';

/** Guesses per code. 5 guesses at a 6-digit code is a 1 in 200,000 chance. */
export const MAX_OTP_ATTEMPTS = 5;

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
  if (!tx || tx.step !== 'otp' || !tx.otpHash || !tx.phone) {
    return apiError(400, 'invalid_transaction', 'This login has expired. Please start again.');
  }
  if ((tx.otpExpiresAt ?? 0) <= nowSeconds()) {
    return apiError(400, 'invalid_code', 'This code has expired. Please request a new one.');
  }
  if (!(await recordOtpAttempt(tx.id, MAX_OTP_ATTEMPTS))) {
    return apiError(429, 'too_many_attempts', 'Too many wrong codes. Please request a new one.');
  }
  if (!safeEqual(await hmac(`otp:${tx.id}`, code), tx.otpHash)) {
    return apiError(400, 'invalid_code', 'That code is not right. Please check it and try again.');
  }

  try {
    const user = await findUserByPhone(tx.phone);
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

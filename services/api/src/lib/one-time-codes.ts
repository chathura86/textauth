import { randomInt } from 'node:crypto';
import { nowSeconds } from '../store/db.js';
import {
  pendingCode,
  recordCodeAttempt,
  recordCodeSent,
  type CodeChannel,
  type LoginTransaction,
} from '../store/login-transactions.js';
import { hmac, safeEqual } from './hash.js';
import { apiError, type HttpResult } from './http.js';

/** How long a code is valid (never beyond the login transaction itself). */
export const CODE_TTL_SECONDS = 10 * 60;
export const RESEND_AFTER_SECONDS = 30;
/** Codes per login transaction and channel, across all numbers/addresses tried in it. */
export const MAX_SENDS_PER_TRANSACTION = 3;
/** Guesses per code. 5 guesses at a 6-digit code is a 1 in 200,000 chance. */
export const MAX_CODE_ATTEMPTS = 5;

export type ResendCheck = 'ok' | 'cooldown' | 'too_many_sends';

/** Cheap pre-check for a friendly error; recordCodeSent enforces the same limits atomically. */
export function checkResend(tx: LoginTransaction, channel: CodeChannel): ResendCheck {
  const sentAt = channel === 'otp' ? tx.otpSentAt : tx.emailCodeSentAt;
  const sendCount = channel === 'otp' ? tx.otpSendCount : tx.emailCodeSendCount;
  if (sentAt !== undefined && nowSeconds() - sentAt < RESEND_AFTER_SECONDS) return 'cooldown';
  if ((sendCount ?? 0) >= MAX_SENDS_PER_TRANSACTION) return 'too_many_sends';
  return 'ok';
}

/**
 * Generates a 6-digit code for `target` and records its hash on the transaction. Returns the
 * plain code for the caller to send, or undefined if a parallel request beat it to the send
 * limits.
 */
export async function issueCode(
  tx: LoginTransaction,
  channel: CodeChannel,
  target: string,
): Promise<string | undefined> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const recorded = await recordCodeSent(
    tx.id,
    channel,
    {
      target,
      hash: await hashCode(tx, channel, code),
      expiresAt: Math.min(nowSeconds() + CODE_TTL_SECONDS, tx.expiresAt),
    },
    { maxSends: MAX_SENDS_PER_TRANSACTION, resendAfterSeconds: RESEND_AFTER_SECONDS },
  );
  return recorded ? code : undefined;
}

export type CodeCheck =
  | { result: 'ok'; target: string }
  | { result: 'no_code' | 'expired' | 'too_many_attempts' | 'wrong' };

/** Checks a submitted code, counting the guess. Doesn't move the transaction on. */
export async function checkCode(tx: LoginTransaction, channel: CodeChannel, submitted: string): Promise<CodeCheck> {
  const pending = pendingCode(tx, channel);
  if (!pending) return { result: 'no_code' };
  if (pending.expiresAt <= nowSeconds()) return { result: 'expired' };
  if (!(await recordCodeAttempt(tx.id, channel, MAX_CODE_ATTEMPTS))) return { result: 'too_many_attempts' };
  if (!safeEqual(await hashCode(tx, channel, submitted), pending.hash)) return { result: 'wrong' };
  return { result: 'ok', target: pending.target };
}

/** The user-facing answer for a code that didn't check out. */
export function codeError(result: Exclude<CodeCheck['result'], 'ok'>): HttpResult {
  switch (result) {
    case 'no_code':
      return apiError(400, 'invalid_transaction', 'This login has expired. Please start again.');
    case 'expired':
      return apiError(400, 'invalid_code', 'This code has expired. Please request a new one.');
    case 'too_many_attempts':
      return apiError(429, 'too_many_attempts', 'Too many wrong codes. Please request a new one.');
    case 'wrong':
      return apiError(400, 'invalid_code', 'That code is not right. Please check it and try again.');
  }
}

function hashCode(tx: LoginTransaction, channel: CodeChannel, code: string): Promise<string> {
  return hmac(`${channel}:${tx.id}`, code);
}

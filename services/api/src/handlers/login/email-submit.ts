import type { NextStep } from '@textauth/shared';
import { getEmailSender, isSyntheticEmail } from '../../email/index.js';
import { getConfig } from '../../lib/config.js';
import { apiError, httpHandler, json, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { checkResend, issueCode } from '../../lib/one-time-codes.js';
import { parseJsonBody, stringField } from '../../lib/request.js';
import { canSendCode, getLoginTransaction } from '../../store/login-transactions.js';
import { consumeRateLimit } from '../../store/rate-limits.js';
import { isEmailTaken } from '../../store/users.js';

/** Stops one login (or a few) being used to mail-bomb someone else's inbox. */
export const EMAIL_LIMIT = { limit: 5, windowSeconds: 60 * 60 };

/** Deliberately loose — the verification code is the real check. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/email — EmailSubmitRequest -> NextStep (email-verify).
 *
 * Emails a code to the address; it only becomes the user's email once they enter it
 * (email-verify). Also used to change the address or resend while on the email-verify step.
 */
export async function emailSubmit(event: HttpEvent): Promise<HttpResult> {
  const body = parseJsonBody(event);
  const txId = body && stringField(body, 'tx');
  const email = body && stringField(body, 'email', 254);
  if (!txId || !email) {
    return apiError(400, 'invalid_request', 'tx and email are required');
  }

  const tx = await getLoginTransaction(txId);
  if (!tx || !canSendCode(tx, 'email')) {
    return apiError(400, 'invalid_transaction', 'This login has expired. Please start again.');
  }

  if (!EMAIL_PATTERN.test(email) || isSyntheticEmail(email, getConfig().syntheticEmailDomain)) {
    return apiError(400, 'invalid_request', 'Please enter a valid email address.');
  }
  if (await isEmailTaken(email)) {
    return apiError(409, 'email_in_use', 'This email is already used by another account. Use a different one, or skip.');
  }

  switch (checkResend(tx, 'email')) {
    case 'cooldown':
      return apiError(429, 'rate_limited', 'Please wait a moment before requesting another code.');
    case 'too_many_sends':
      return apiError(429, 'rate_limited', 'Too many codes requested. Please skip, or start again later.');
  }
  if (!(await consumeRateLimit({ key: `email:${email.toLowerCase()}`, ...EMAIL_LIMIT }))) {
    return apiError(429, 'rate_limited', 'Too many codes sent to this email. Please try again later.');
  }

  const code = await issueCode(tx, 'email', email);
  if (!code) {
    return apiError(429, 'rate_limited', 'Please wait a moment before requesting another code.');
  }

  const sender = await getEmailSender();
  const { id } = await sender.send({
    to: email,
    subject: `${code} is your LionSports verification code`,
    text:
      `Your LionSports verification code is ${code}.\n\n` +
      `Enter it on the login page to confirm this email address. It expires in 10 minutes.\n\n` +
      `If you didn't request this, you can ignore this email.`,
  });
  console.log(JSON.stringify({ msg: 'Email code sent', tx: tx.id, resendId: id }));

  return json(200, { step: 'email-verify', email } satisfies NextStep);
}

export const handler = httpHandler(emailSubmit);

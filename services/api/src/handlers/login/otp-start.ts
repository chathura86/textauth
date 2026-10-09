import { randomInt } from 'node:crypto';
import type { OtpStartResponse } from '@textauth/shared';
import { hmac } from '../../lib/hash.js';
import { apiError, httpHandler, json, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { normalizePhone } from '../../lib/phone.js';
import { verifyRecaptcha } from '../../lib/recaptcha.js';
import { parseJsonBody, stringField } from '../../lib/request.js';
import { getSmsGatewayFactory, UnsupportedCountryError, type SmsGateway } from '../../sms/index.js';
import { getLoginTransaction, recordOtpSent } from '../../store/login-transactions.js';
import { consumeRateLimit } from '../../store/rate-limits.js';
import { nowSeconds } from '../../store/db.js';

export const OTP_TTL_SECONDS = 10 * 60;
export const RESEND_AFTER_SECONDS = 30;
/** Codes per login transaction, across all numbers tried in it. */
export const MAX_SENDS_PER_TRANSACTION = 3;
export const PHONE_LIMIT = { limit: 5, windowSeconds: 60 * 60 };
/**
 * Circuit breaker against SMS pumping: a sudden flood to one country (typically premium-rate
 * ranges) stops at this many codes per hour instead of running up the bill.
 */
export const COUNTRY_LIMIT = { limit: 200, windowSeconds: 60 * 60 };

/**
 * POST /api/otp/start — OtpStartRequest -> OtpStartResponse.
 *
 * Checks are ordered cheapest-first, and nothing that costs money (rate-limit writes, the SMS
 * itself) happens until the request has passed reCAPTCHA and the number is known to be valid
 * and routable.
 */
export async function otpStart(event: HttpEvent): Promise<HttpResult> {
  const body = parseJsonBody(event);
  const txId = body && stringField(body, 'tx');
  const rawPhone = body && stringField(body, 'phone', 32);
  const recaptchaToken = body && stringField(body, 'recaptchaToken', 4096);
  if (!body || !txId || !rawPhone || !recaptchaToken) {
    return apiError(400, 'invalid_request', 'tx, phone and recaptchaToken are required');
  }

  const tx = await getLoginTransaction(txId);
  if (!tx || (tx.step !== 'phone' && tx.step !== 'otp')) {
    return apiError(400, 'invalid_transaction', 'This login has expired. Please start again.');
  }

  if (!(await verifyRecaptcha(recaptchaToken, 'otp_start'))) {
    return apiError(400, 'captcha_failed', 'We could not verify you are human. Please try again.');
  }

  const phone = normalizePhone(rawPhone, stringField(body, 'country', 2));
  if (!phone) {
    return apiError(400, 'invalid_phone', 'Please enter a valid phone number.');
  }

  let gateway: SmsGateway;
  try {
    gateway = getSmsGatewayFactory().forPhoneNumber(phone.e164);
  } catch (err) {
    if (err instanceof UnsupportedCountryError) {
      return apiError(400, 'unsupported_country', 'Phone numbers from this country are not supported yet.');
    }
    throw err;
  }

  const now = nowSeconds();
  if (tx.otpSentAt !== undefined && now - tx.otpSentAt < RESEND_AFTER_SECONDS) {
    return apiError(429, 'rate_limited', 'Please wait a moment before requesting another code.');
  }
  if ((tx.otpSendCount ?? 0) >= MAX_SENDS_PER_TRANSACTION) {
    return apiError(429, 'rate_limited', 'Too many codes requested. Please start again later.');
  }
  const withinLimits =
    (await consumeRateLimit({ key: `phone:${phone.e164}`, ...PHONE_LIMIT })) &&
    (await consumeRateLimit({ key: `country:${phone.country ?? 'unknown'}`, ...COUNTRY_LIMIT }));
  if (!withinLimits) {
    return apiError(429, 'rate_limited', 'Too many codes requested. Please try again later.');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const recorded = await recordOtpSent(
    tx.id,
    {
      phone: phone.e164,
      otpHash: await hmac(`otp:${tx.id}`, code),
      otpExpiresAt: Math.min(now + OTP_TTL_SECONDS, tx.expiresAt),
    },
    { maxSends: MAX_SENDS_PER_TRANSACTION, resendAfterSeconds: RESEND_AFTER_SECONDS },
  );
  if (!recorded) {
    // A parallel request for the same login won the race (or it moved past this step).
    return apiError(429, 'rate_limited', 'Please wait a moment before requesting another code.');
  }

  const result = await gateway.send({ to: phone.e164, body: smsBody(code) });
  console.log(JSON.stringify({ msg: 'OTP sent', tx: tx.id, country: phone.country, ...result }));

  return json(200, { resendAfterSeconds: RESEND_AFTER_SECONDS } satisfies OtpStartResponse);
}

export const handler = httpHandler(otpStart);

/**
 * The last line is the WebOTP / iOS one-time-code format, which lets phones offer the code for
 * autofill on our login page (and only on our login page).
 */
function smsBody(code: string): string {
  return `${code} is your LionSports login code. It expires in 10 minutes.\n\n@textauth.lionsportsusa.com #${code}`;
}

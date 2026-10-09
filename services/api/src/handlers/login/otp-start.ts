import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * POST /api/otp/start — OtpStartRequest -> OtpStartResponse.
 *
 * TODO: verify reCAPTCHA, normalise the phone to E.164, enforce per-phone/per-country limits
 * and resend cooldown, pick the gateway via getSmsGatewayFactory(), store the hashed code on
 * the transaction and send it.
 */
export const handler = httpHandler(notImplemented);

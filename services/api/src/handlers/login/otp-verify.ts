import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * POST /api/otp/verify — OtpVerifyRequest -> NextStep.
 *
 * TODO: check the code (max attempts), then find the user by phone. A known user with an email
 * goes straight to "done"; a new user (or one without email) goes to "email".
 */
export const handler = httpHandler(notImplemented);

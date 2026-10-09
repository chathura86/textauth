import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * POST /api/email — EmailSubmitRequest -> NextStep (email-verify).
 *
 * TODO: validate, check it isn't another user's email, email a code via Resend.
 */
export const handler = httpHandler(notImplemented);

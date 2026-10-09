import { httpHandler, notImplemented } from '../../lib/http.js';

/**
 * POST /api/email/skip — SkipEmailRequest -> NextStep (done).
 *
 * TODO: assign generateSyntheticEmail() (always email_verified), then finish like email-verify.
 */
export const handler = httpHandler(notImplemented);

import { generateSyntheticEmail } from '../../email/index.js';
import { getConfig } from '../../lib/config.js';
import { createAccountAndCompleteLogin } from '../../lib/create-account.js';
import { apiError, httpHandler, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { parseJsonBody, stringField } from '../../lib/request.js';
import { getLoginTransaction } from '../../store/login-transactions.js';

/**
 * POST /api/email/skip — SkipEmailRequest -> NextStep (done).
 *
 * For users without an email: the account gets a synthetic address (never shown to them). Can
 * also be used from the email-verify step if they give up on verifying theirs.
 */
export async function emailSkip(event: HttpEvent): Promise<HttpResult> {
  const body = parseJsonBody(event);
  const txId = body && stringField(body, 'tx');
  if (!txId) {
    return apiError(400, 'invalid_request', 'tx is required');
  }

  const tx = await getLoginTransaction(txId);
  if (!tx || (tx.step !== 'email' && tx.step !== 'email-verify')) {
    return apiError(400, 'invalid_transaction', 'This login has expired. Please start again.');
  }

  const domain = getConfig().syntheticEmailDomain;
  return createAccountAndCompleteLogin(tx, tx.step, () => generateSyntheticEmail(domain), 'synthetic');
}

export const handler = httpHandler(emailSkip);

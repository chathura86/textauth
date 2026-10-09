import { createAccountAndCompleteLogin } from '../../lib/create-account.js';
import { apiError, httpHandler, type HttpEvent, type HttpResult } from '../../lib/http.js';
import { checkCode, codeError } from '../../lib/one-time-codes.js';
import { parseJsonBody, stringField } from '../../lib/request.js';
import { getLoginTransaction } from '../../store/login-transactions.js';

/**
 * POST /api/email/verify — EmailVerifyRequest -> NextStep (done).
 *
 * The code proves the user owns the address, so the account is created with it as their
 * (verified) email and the login completes.
 */
export async function emailVerify(event: HttpEvent): Promise<HttpResult> {
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
  const check = await checkCode(tx, 'email', code);
  if (check.result !== 'ok') {
    return codeError(check.result);
  }

  return createAccountAndCompleteLogin(tx, 'email-verify', check.target, 'user');
}

export const handler = httpHandler(emailVerify);

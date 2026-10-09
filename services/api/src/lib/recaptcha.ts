import { getConfig } from './config.js';
import { getAppSecret } from './secrets.js';

/** reCAPTCHA v3 scores run 0 (bot) to 1 (human); Google suggests 0.5 as a starting threshold. */
export const RECAPTCHA_MIN_SCORE = 0.5;

interface SiteVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

/**
 * Checks a reCAPTCHA v3 token with Google. Besides `success`, the token must have been made for
 * this action on our own hostname — otherwise a token solved on some other page (or for another
 * action) could be replayed here.
 */
export async function verifyRecaptcha(token: string, expectedAction: string): Promise<boolean> {
  const { recaptchaSecretKey } = await getAppSecret();
  const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
    method: 'POST',
    body: new URLSearchParams({ secret: recaptchaSecretKey, response: token }),
  });
  if (!response.ok) {
    throw new Error(`reCAPTCHA siteverify returned ${response.status}`);
  }
  const result = (await response.json()) as SiteVerifyResponse;
  const expectedHostname = new URL(getConfig().publicBaseUrl).hostname;

  const passed =
    result.success &&
    result.action === expectedAction &&
    result.hostname === expectedHostname &&
    (result.score ?? 0) >= RECAPTCHA_MIN_SCORE;
  if (!passed) {
    console.warn(JSON.stringify({ msg: 'reCAPTCHA rejected', ...result }));
  }
  return passed;
}

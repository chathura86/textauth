import { getConfig } from '../lib/config.js';
import { getResendApiKey } from '../lib/secrets.js';
import { ResendEmailSender } from './resend-email-sender.js';

export type { EmailMessage } from './resend-email-sender.js';
export { generateSyntheticEmail, isSyntheticEmail } from './synthetic-email.js';

let sender: Promise<ResendEmailSender> | undefined;

/** Lazily built once per Lambda container. */
export function getEmailSender(): Promise<ResendEmailSender> {
  sender ??= getResendApiKey().then((apiKey) => new ResendEmailSender(apiKey, getConfig().emailFrom));
  return sender;
}

import { randomInt } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 10;

/**
 * Builds a placeholder address like `u_7f3k9x2m4q@users.textauth.lionsportsusa.com` for users
 * who don't give an email. Deliberately random rather than derived from the phone number:
 * numbers get recycled and changed, and the address must stay with the user, not the number.
 *
 * Callers must still store it with a uniqueness check — random isn't the same as unique.
 * The domain has a null MX record, so anything sent to these addresses is refused.
 */
export function generateSyntheticEmail(domain: string): string {
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return `u_${id}@${domain}`;
}

export function isSyntheticEmail(email: string, domain: string): boolean {
  return email.toLowerCase().endsWith(`@${domain.toLowerCase()}`);
}

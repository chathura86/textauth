import { createHmac, timingSafeEqual } from 'node:crypto';
import { getAppSecret } from './secrets.js';

/**
 * Keyed hash for codes and tokens we store. `purpose` keeps one kind of value from ever
 * matching another (an SMS code can't be replayed as an authorization code).
 */
export async function hmac(purpose: string, value: string): Promise<string> {
  const { hashKey } = await getAppSecret();
  return createHmac('sha256', hashKey).update(`${purpose}:${value}`).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

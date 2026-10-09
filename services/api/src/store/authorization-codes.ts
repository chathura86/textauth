import { randomBytes } from 'node:crypto';
import { PutCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { hmac } from '../lib/hash.js';
import { db, nowSeconds } from './db.js';

/** Auth0 redeems the code right after the redirect; anything longer is just exposure. */
export const AUTHORIZATION_CODE_TTL_SECONDS = 60;

export interface AuthorizationCode {
  userId: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  codeChallenge?: string;
}

/** Stores the code under its hash and returns the plain code (which is never stored). */
export async function createAuthorizationCode(grant: AuthorizationCode): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await db.send(
    new PutCommand({
      TableName: getConfig().tableName,
      Item: {
        pk: `CODE#${await hmac('code', code)}`,
        sk: 'CODE',
        ...grant,
        expiresAt: nowSeconds() + AUTHORIZATION_CODE_TTL_SECONDS,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  return code;
}

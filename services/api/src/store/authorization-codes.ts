import { randomBytes } from 'node:crypto';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
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

const key = async (code: string) => ({ pk: `CODE#${await hmac('code', code)}`, sk: 'CODE' });

/** Stores the code under its hash and returns the plain code (which is never stored). */
export async function createAuthorizationCode(grant: AuthorizationCode): Promise<string> {
  const code = randomBytes(32).toString('base64url');
  await db.send(
    new PutCommand({
      TableName: getConfig().tableName,
      Item: {
        ...(await key(code)),
        ...grant,
        expiresAt: nowSeconds() + AUTHORIZATION_CODE_TTL_SECONDS,
      },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  return code;
}

/**
 * Deletes the code and returns what it granted — in one call, so a code can be redeemed at most
 * once even if two token requests race. Unknown, used and expired codes all return undefined.
 */
export async function consumeAuthorizationCode(code: string): Promise<AuthorizationCode | undefined> {
  try {
    const { Attributes } = await db.send(
      new DeleteCommand({
        TableName: getConfig().tableName,
        Key: await key(code),
        ConditionExpression: 'attribute_exists(pk)',
        ReturnValues: 'ALL_OLD',
      }),
    );
    if (!Attributes || (Attributes.expiresAt as number) <= nowSeconds()) return undefined;
    const { pk: _pk, sk: _sk, expiresAt: _expiresAt, ...grant } = Attributes;
    return grant as AuthorizationCode;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return undefined;
    throw err;
  }
}

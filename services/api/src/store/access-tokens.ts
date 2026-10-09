import { randomBytes } from 'node:crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { hmac } from '../lib/hash.js';
import { db, nowSeconds } from './db.js';

/**
 * Auth0 calls /oauth/userinfo once, right after the token exchange; the token has no other use.
 * An hour leaves room for retries without keeping it around.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

export interface AccessToken {
  userId: string;
  clientId: string;
  scope?: string;
}

const key = async (token: string) => ({ pk: `TOKEN#${await hmac('token', token)}`, sk: 'TOKEN' });

/** Opaque bearer token, stored only as a hash. */
export async function createAccessToken(grant: AccessToken): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db.send(
    new PutCommand({
      TableName: getConfig().tableName,
      Item: { ...(await key(token)), ...grant, expiresAt: nowSeconds() + ACCESS_TOKEN_TTL_SECONDS },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  return token;
}

/** Undefined for unknown and expired tokens alike. */
export async function getAccessToken(token: string): Promise<AccessToken | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: getConfig().tableName, Key: await key(token) }));
  if (!Item || (Item.expiresAt as number) <= nowSeconds()) return undefined;
  const { pk: _pk, sk: _sk, expiresAt: _expiresAt, ...grant } = Item;
  return grant as AccessToken;
}

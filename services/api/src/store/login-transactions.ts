import { randomBytes } from 'node:crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { db, nowSeconds } from './db.js';

/** How long a user has to finish logging in once Auth0 sends them to us. */
export const LOGIN_TRANSACTION_TTL_SECONDS = 15 * 60;

export type LoginStep = 'phone' | 'otp' | 'email' | 'email-verify' | 'done';

/**
 * One login attempt, from /oauth/authorize until the code is handed back to Auth0. The UI
 * carries its id (`tx`) on every call; everything else stays server-side.
 */
export interface LoginTransaction {
  id: string;
  step: LoginStep;
  /** The OAuth request Auth0 made — echoed back when the login completes. */
  oauth: {
    clientId: string;
    redirectUri: string;
    state: string;
    scope?: string;
    codeChallenge?: string;
  };
  createdAt: number;
  /** Epoch seconds. Also the table's TTL attribute, but TTL deletes lazily, so always check. */
  expiresAt: number;
}

const key = (id: string) => ({ pk: `TX#${id}`, sk: 'TX' });

export async function createLoginTransaction(oauth: LoginTransaction['oauth']): Promise<LoginTransaction> {
  const now = nowSeconds();
  const tx: LoginTransaction = {
    // 256 bits: the id is the only thing standing between a URL and someone else's login.
    id: randomBytes(32).toString('base64url'),
    step: 'phone',
    oauth,
    createdAt: now,
    expiresAt: now + LOGIN_TRANSACTION_TTL_SECONDS,
  };
  await db.send(
    new PutCommand({
      TableName: getConfig().tableName,
      Item: { ...key(tx.id), ...tx },
      ConditionExpression: 'attribute_not_exists(pk)',
    }),
  );
  return tx;
}

/** Returns undefined for unknown and expired transactions alike. */
export async function getLoginTransaction(id: string): Promise<LoginTransaction | undefined> {
  const { Item } = await db.send(
    new GetCommand({ TableName: getConfig().tableName, Key: key(id), ConsistentRead: true }),
  );
  if (!Item || (Item.expiresAt as number) <= nowSeconds()) {
    return undefined;
  }
  const { pk: _pk, sk: _sk, ...tx } = Item;
  return tx as LoginTransaction;
}

import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { db } from './db.js';

export interface User {
  /** Stable id, Auth0's `user_id` for this connection. Never derived from the phone or email. */
  id: string;
  /** E.164. */
  phone: string;
  email: string;
  /** 'user' = entered and verified by the user; 'synthetic' = generated, hidden from them. */
  emailSource: 'user' | 'synthetic';
  createdAt: number;
  updatedAt: number;
}

export async function findUserByPhone(phone: string): Promise<User | undefined> {
  const tableName = getConfig().tableName;
  const { Item: link } = await db.send(
    new GetCommand({ TableName: tableName, Key: { pk: `PHONE#${phone}`, sk: 'USER' } }),
  );
  if (!link) return undefined;

  const { Item } = await db.send(
    new GetCommand({ TableName: tableName, Key: { pk: `USER#${link.userId as string}`, sk: 'PROFILE' } }),
  );
  if (!Item) return undefined;
  const { pk: _pk, sk: _sk, ...user } = Item;
  return user as User;
}

import { randomUUID } from 'node:crypto';
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { db, nowSeconds } from './db.js';

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

/** Thrown by createUser when the phone or email already belongs to someone. */
export class UserConflictError extends Error {
  constructor(readonly field: 'phone' | 'email') {
    super(`A user with this ${field} already exists`);
    this.name = 'UserConflictError';
  }
}

const userKey = (id: string) => ({ pk: `USER#${id}`, sk: 'PROFILE' });
const phoneKey = (phone: string) => ({ pk: `PHONE#${phone}`, sk: 'USER' });
/** Emails are unique case-insensitively; the profile keeps the casing the user typed. */
const emailKey = (email: string) => ({ pk: `EMAIL#${email.toLowerCase()}`, sk: 'USER' });

export async function findUserById(id: string): Promise<User | undefined> {
  const { Item } = await db.send(new GetCommand({ TableName: getConfig().tableName, Key: userKey(id) }));
  if (!Item) return undefined;
  const { pk: _pk, sk: _sk, ...user } = Item;
  return user as User;
}

export async function findUserByPhone(phone: string): Promise<User | undefined> {
  const { Item: link } = await db.send(new GetCommand({ TableName: getConfig().tableName, Key: phoneKey(phone) }));
  return link ? findUserById(link.userId as string) : undefined;
}

export async function isEmailTaken(email: string): Promise<boolean> {
  const { Item } = await db.send(new GetCommand({ TableName: getConfig().tableName, Key: emailKey(email) }));
  return Item !== undefined;
}

/**
 * Creates the profile plus the PHONE#/EMAIL# items that make phone and email unique, in one
 * transaction — so two sign-ups racing for the same phone or email can't both win.
 */
export async function createUser(input: Pick<User, 'phone' | 'email' | 'emailSource'>): Promise<User> {
  const now = nowSeconds();
  const user: User = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
  const tableName = getConfig().tableName;
  const ifNew = 'attribute_not_exists(pk)';

  try {
    await db.send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: tableName, Item: { ...userKey(user.id), ...user }, ConditionExpression: ifNew } },
          { Put: { TableName: tableName, Item: { ...phoneKey(user.phone), userId: user.id }, ConditionExpression: ifNew } },
          { Put: { TableName: tableName, Item: { ...emailKey(user.email), userId: user.id }, ConditionExpression: ifNew } },
        ],
      }),
    );
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      // Reasons line up with TransactItems: [profile, phone, email].
      const failed = err.CancellationReasons?.map((reason) => reason.Code === 'ConditionalCheckFailed');
      if (failed?.[1]) throw new UserConflictError('phone');
      if (failed?.[2]) throw new UserConflictError('email');
    }
    throw err;
  }
  return user;
}

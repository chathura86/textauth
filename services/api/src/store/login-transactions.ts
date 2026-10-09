import { randomBytes } from 'node:crypto';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
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

  /** E.164 number the current code was sent to; verified once step moves past 'otp'. */
  phone?: string;
  /** HMAC of the current SMS code — never the code itself. */
  otpHash?: string;
  otpSentAt?: number;
  otpExpiresAt?: number;
  /** Wrong + right guesses against the current code. Reset when a new code is sent. */
  otpAttempts?: number;
  /** Codes sent in this transaction, across any phone numbers the user tried. */
  otpSendCount?: number;
  /** Set once the phone is verified and belongs to an existing user. */
  userId?: string;
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

/**
 * Records a freshly generated code (before it's sent, so a crash mid-send can't leave a code
 * the server doesn't know). Only allowed while the user is still on the phone/code steps, and
 * the send limits are enforced in the same write so parallel requests can't both get through.
 * Returns false if a limit (or the step) stopped it.
 */
export async function recordOtpSent(
  id: string,
  otp: { phone: string; otpHash: string; otpExpiresAt: number },
  limits: { maxSends: number; resendAfterSeconds: number },
): Promise<boolean> {
  const now = nowSeconds();
  try {
    await db.send(
      new UpdateCommand({
        TableName: getConfig().tableName,
        Key: key(id),
        UpdateExpression:
          'SET step = :otp, phone = :phone, otpHash = :hash, otpSentAt = :now, otpExpiresAt = :exp, otpAttempts = :zero ' +
          'ADD otpSendCount :one',
        ConditionExpression:
          'step IN (:phone_step, :otp) ' +
          'AND (attribute_not_exists(otpSendCount) OR otpSendCount < :max_sends) ' +
          'AND (attribute_not_exists(otpSentAt) OR otpSentAt <= :resend_cutoff)',
        ExpressionAttributeValues: {
          ':otp': 'otp',
          ':phone_step': 'phone',
          ':phone': otp.phone,
          ':hash': otp.otpHash,
          ':now': now,
          ':exp': otp.otpExpiresAt,
          ':zero': 0,
          ':one': 1,
          ':max_sends': limits.maxSends,
          ':resend_cutoff': now - limits.resendAfterSeconds,
        },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/**
 * Counts one guess against the current code, atomically, so parallel requests can't get more
 * than `maxAttempts` guesses. Returns false once the limit is used up.
 */
export async function recordOtpAttempt(id: string, maxAttempts: number): Promise<boolean> {
  try {
    await db.send(
      new UpdateCommand({
        TableName: getConfig().tableName,
        Key: key(id),
        UpdateExpression: 'ADD otpAttempts :one',
        ConditionExpression: 'step = :otp AND otpAttempts < :max',
        ExpressionAttributeValues: { ':one': 1, ':otp': 'otp', ':max': maxAttempts },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/**
 * Moves the transaction from one step to the next, failing if another request already moved it
 * (e.g. the same code submitted twice).
 */
export async function advanceLoginTransaction(
  id: string,
  from: LoginStep,
  to: LoginStep,
  changes: Partial<Pick<LoginTransaction, 'userId'>> = {},
): Promise<void> {
  const sets = ['step = :to', 'otpHash = :none'];
  const values: Record<string, unknown> = { ':from': from, ':to': to, ':none': null };
  for (const [field, value] of Object.entries(changes)) {
    sets.push(`${field} = :${field}`);
    values[`:${field}`] = value;
  }
  await db.send(
    new UpdateCommand({
      TableName: getConfig().tableName,
      Key: key(id),
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'step = :from',
      ExpressionAttributeValues: values,
    }),
  );
}

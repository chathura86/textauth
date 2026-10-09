import { randomBytes } from 'node:crypto';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { db, nowSeconds } from './db.js';

/** How long a user has to finish logging in once Auth0 sends them to us. */
export const LOGIN_TRANSACTION_TTL_SECONDS = 15 * 60;

export type LoginStep = 'phone' | 'otp' | 'email' | 'email-verify' | 'done';

/**
 * A one-time code sent during login: 'otp' by SMS to `phone`, 'email' by email to
 * `pendingEmail`. Each has its own set of fields on the transaction (see CODE_FIELDS).
 */
export type CodeChannel = 'otp' | 'email';

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

  /** E.164 number the current SMS code was sent to; verified once step moves past 'otp'. */
  phone?: string;
  /** HMAC of the current SMS code — never the code itself. */
  otpHash?: string;
  otpSentAt?: number;
  otpExpiresAt?: number;
  /** Wrong + right guesses against the current code. Reset when a new code is sent. */
  otpAttempts?: number;
  /** Codes sent in this transaction, across any phone numbers the user tried. */
  otpSendCount?: number;

  /** Email the current email code was sent to; becomes the user's email once verified. */
  pendingEmail?: string;
  emailCodeHash?: string;
  emailCodeSentAt?: number;
  emailCodeExpiresAt?: number;
  emailCodeAttempts?: number;
  emailCodeSendCount?: number;

  /** The user the login ended as. */
  userId?: string;
}

/** Per channel: its field names, which steps may (re)send a code, and the step it leads to. */
const CODE_FIELDS = {
  otp: {
    target: 'phone',
    hash: 'otpHash',
    sentAt: 'otpSentAt',
    expiresAt: 'otpExpiresAt',
    attempts: 'otpAttempts',
    sendCount: 'otpSendCount',
    sendFrom: ['phone', 'otp'],
    waitStep: 'otp',
  },
  email: {
    target: 'pendingEmail',
    hash: 'emailCodeHash',
    sentAt: 'emailCodeSentAt',
    expiresAt: 'emailCodeExpiresAt',
    attempts: 'emailCodeAttempts',
    sendCount: 'emailCodeSendCount',
    sendFrom: ['email', 'email-verify'],
    waitStep: 'email-verify',
  },
} as const satisfies Record<CodeChannel, Record<string, unknown>>;

/** The steps from which a code can be (re)sent on this channel. */
export function canSendCode(tx: LoginTransaction, channel: CodeChannel): boolean {
  return (CODE_FIELDS[channel].sendFrom as readonly LoginStep[]).includes(tx.step);
}

/** The pending code on this channel, if the transaction is waiting for one. */
export function pendingCode(
  tx: LoginTransaction,
  channel: CodeChannel,
): { target: string; hash: string; sentAt: number; expiresAt: number; sendCount: number } | undefined {
  const f = CODE_FIELDS[channel];
  const target = tx[f.target];
  const hash = tx[f.hash];
  if (tx.step !== f.waitStep || !target || !hash) return undefined;
  return {
    target,
    hash,
    sentAt: tx[f.sentAt] ?? 0,
    expiresAt: tx[f.expiresAt] ?? 0,
    sendCount: tx[f.sendCount] ?? 0,
  };
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
 * the server doesn't know). Only allowed from the channel's send steps, and the send limits are
 * enforced in the same write so parallel requests can't both get through. Returns false if a
 * limit (or the step) stopped it.
 */
export async function recordCodeSent(
  id: string,
  channel: CodeChannel,
  code: { target: string; hash: string; expiresAt: number },
  limits: { maxSends: number; resendAfterSeconds: number },
): Promise<boolean> {
  const f = CODE_FIELDS[channel];
  const now = nowSeconds();
  try {
    await db.send(
      new UpdateCommand({
        TableName: getConfig().tableName,
        Key: key(id),
        UpdateExpression:
          'SET step = :wait, #target = :target, #hash = :hash, #sentAt = :now, #expiresAt = :exp, #attempts = :zero ' +
          'ADD #sendCount :one',
        ConditionExpression:
          'step IN (:from0, :from1) ' +
          'AND (attribute_not_exists(#sendCount) OR #sendCount < :max_sends) ' +
          'AND (attribute_not_exists(#sentAt) OR #sentAt <= :resend_cutoff)',
        ExpressionAttributeNames: {
          '#target': f.target,
          '#hash': f.hash,
          '#sentAt': f.sentAt,
          '#expiresAt': f.expiresAt,
          '#attempts': f.attempts,
          '#sendCount': f.sendCount,
        },
        ExpressionAttributeValues: {
          ':wait': f.waitStep,
          ':from0': f.sendFrom[0],
          ':from1': f.sendFrom[1],
          ':target': code.target,
          ':hash': code.hash,
          ':now': now,
          ':exp': code.expiresAt,
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
 * Counts one guess against the channel's current code, atomically, so parallel requests can't
 * get more than `maxAttempts` guesses. Returns false once the limit is used up.
 */
export async function recordCodeAttempt(id: string, channel: CodeChannel, maxAttempts: number): Promise<boolean> {
  const f = CODE_FIELDS[channel];
  try {
    await db.send(
      new UpdateCommand({
        TableName: getConfig().tableName,
        Key: key(id),
        UpdateExpression: 'ADD #attempts :one',
        ConditionExpression: 'step = :wait AND #attempts < :max',
        ExpressionAttributeNames: { '#attempts': f.attempts },
        ExpressionAttributeValues: { ':one': 1, ':wait': f.waitStep, ':max': maxAttempts },
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

/**
 * Moves the transaction from one step to the next, failing with ConditionalCheckFailedException
 * if another request already moved it (e.g. the same code submitted twice). Pending code hashes
 * are cleared so a used code can't be checked again.
 */
export async function advanceLoginTransaction(
  id: string,
  from: LoginStep,
  to: LoginStep,
  changes: Partial<Pick<LoginTransaction, 'userId'>> = {},
): Promise<void> {
  const sets = ['step = :to'];
  const values: Record<string, unknown> = { ':from': from, ':to': to };
  for (const [field, value] of Object.entries(changes)) {
    sets.push(`${field} = :${field}`);
    values[`:${field}`] = value;
  }
  await db.send(
    new UpdateCommand({
      TableName: getConfig().tableName,
      Key: key(id),
      UpdateExpression: `SET ${sets.join(', ')} REMOVE otpHash, emailCodeHash`,
      ConditionExpression: 'step = :from',
      ExpressionAttributeValues: values,
    }),
  );
}

import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../lib/config.js';
import { db, nowSeconds } from './db.js';

export interface RateLimit {
  /** What's being limited, e.g. `phone:+12015550123`. */
  key: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window counter: counts this call and returns false if it goes over the limit. The call
 * is counted either way, so hammering a blocked key keeps it blocked until the window ends.
 */
export async function consumeRateLimit({ key, limit, windowSeconds }: RateLimit): Promise<boolean> {
  const windowStart = Math.floor(nowSeconds() / windowSeconds) * windowSeconds;
  const { Attributes } = await db.send(
    new UpdateCommand({
      TableName: getConfig().tableName,
      Key: { pk: `RL#${key}`, sk: String(windowStart) },
      UpdateExpression: 'ADD hits :one SET expiresAt = if_not_exists(expiresAt, :exp)',
      ExpressionAttributeValues: { ':one': 1, ':exp': windowStart + windowSeconds },
      ReturnValues: 'UPDATED_NEW',
    }),
  );
  return (Attributes?.hits as number) <= limit;
}

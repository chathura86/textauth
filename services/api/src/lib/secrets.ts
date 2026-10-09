import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { getConfig, type AppSecret } from './config.js';

const client = new SecretsManagerClient({});

// Cached per Lambda container. Rotating a secret means waiting out (or forcing) a cold start.
const cache = new Map<string, Promise<unknown>>();

function getJsonSecret<T>(secretId: string): Promise<T> {
  let value = cache.get(secretId);
  if (!value) {
    value = client.send(new GetSecretValueCommand({ SecretId: secretId })).then((result) => {
      if (!result.SecretString) {
        throw new Error(`Secret ${secretId} has no string value`);
      }
      return JSON.parse(result.SecretString) as unknown;
    });
    // Don't cache a failure — let the next request retry.
    value.catch(() => cache.delete(secretId));
    cache.set(secretId, value);
  }
  return value as Promise<T>;
}

export function getAppSecret(): Promise<AppSecret> {
  return getJsonSecret<AppSecret>(getConfig().appSecretArn);
}

export async function getResendApiKey(): Promise<string> {
  const secret = await getJsonSecret<{ resendApiKey: string }>(getConfig().resendSecretArn);
  return secret.resendApiKey;
}

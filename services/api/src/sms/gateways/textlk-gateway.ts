import type { SmsGateway, SmsMessage, SmsSendResult } from '../types.js';

export interface TextLkCredentials {
  apiToken: string;
  /** Sender ID registered with Text.lk (alphanumeric, max 11 characters). */
  senderId: string;
}

interface TextLkResponse {
  status?: 'success' | 'error';
  message?: string;
  data?: { uid?: string };
}

/** Leaves time for the rest of the request inside the 10 s Lambda timeout. */
const TIMEOUT_MS = 6000;

/**
 * Text.lk (https://text.lk/docs/send-sms/) — Sri Lankan SMS gateway. Uses the v3 API with a
 * bearer token, never the legacy GET endpoint that puts the token in the URL.
 */
export class TextLkSmsGateway implements SmsGateway {
  readonly name = 'textlk';

  /** Credentials are fetched lazily so building the factory never needs the secret. */
  constructor(private readonly credentials: () => Promise<TextLkCredentials>) {}

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const { apiToken, senderId } = await this.credentials();
    const response = await fetch('https://app.text.lk/api/v3/sms/send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        // Text.lk wants the number with country code but without the +.
        recipient: message.to.replace(/^\+/, ''),
        sender_id: senderId,
        type: 'plain',
        message: message.body,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const result = (await response.json().catch(() => ({}))) as TextLkResponse;
    if (!response.ok || result.status !== 'success') {
      throw new Error(`Text.lk send failed (HTTP ${response.status}): ${result.message ?? 'no message'}`);
    }
    return { gateway: this.name, messageId: result.data?.uid ?? 'unknown' };
  }
}

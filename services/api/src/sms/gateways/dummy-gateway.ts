import { randomUUID } from 'node:crypto';
import type { SmsGateway, SmsMessage, SmsSendResult } from '../types.js';

/**
 * Sends nothing — writes the message to the log instead, so the whole login flow can be
 * exercised before a real provider is wired up. The log line contains the OTP, so this must
 * not stay routed for real users once real gateways exist.
 */
export class DummySmsGateway implements SmsGateway {
  readonly name = 'dummy';

  async send(message: SmsMessage): Promise<SmsSendResult> {
    const messageId = `dummy-${randomUUID()}`;
    console.log(JSON.stringify({ msg: 'DummySmsGateway: SMS not sent', messageId, ...message }));
    return { gateway: this.name, messageId };
  }
}

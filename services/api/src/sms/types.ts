import type { CountryCode } from 'libphonenumber-js';

export interface SmsMessage {
  /** Destination in E.164, e.g. +14155550123. */
  to: string;
  body: string;
}

export interface SmsSendResult {
  /** Name of the gateway that accepted the message, for logging/auditing. */
  gateway: string;
  /** The provider's own id for the message, for tracing delivery issues with them. */
  messageId: string;
}

/**
 * One SMS provider (Twilio, Vonage, a local carrier, ...). Implementations only send — which
 * gateway handles which country is decided by SmsGatewayFactory, never by the gateway.
 */
export interface SmsGateway {
  readonly name: string;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

/**
 * Which gateway (by SmsGateway.name) serves which country. A country missing from `countries`
 * falls back to `defaultGateway`; with no default it's unsupported, so leaving `defaultGateway`
 * unset turns `countries` into an allowlist (the safer setting against SMS pumping fraud).
 */
export interface SmsRoutingTable {
  countries: Partial<Record<CountryCode, string>>;
  defaultGateway?: string;
}

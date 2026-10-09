import type { SmsCountry } from '@textauth/shared';
import { getConfig } from '../lib/config.js';
import { getJsonSecret } from '../lib/secrets.js';
import { TextLkSmsGateway, type TextLkCredentials } from './gateways/textlk-gateway.js';
import { SmsGatewayFactory } from './sms-gateway-factory.js';
import type { SmsRoutingTable } from './types.js';

export * from './types.js';
export { SmsGatewayFactory, UnsupportedCountryError } from './sms-gateway-factory.js';

/**
 * Country -> gateway routing. Must cover every country in SMS_COUNTRIES (the list the login UI
 * offers), which `satisfies` checks. There's deliberately no default gateway: a number from any
 * other country is rejected, never sent to — the main guard against SMS pumping fraud.
 */
const countries = {
  LK: 'textlk',
} satisfies Record<SmsCountry, string>;

const routing: SmsRoutingTable = { countries };

let factory: SmsGatewayFactory | undefined;

/** Lazily built once per Lambda container. */
export function getSmsGatewayFactory(): SmsGatewayFactory {
  factory ??= new SmsGatewayFactory(
    [new TextLkSmsGateway(() => getJsonSecret<TextLkCredentials>(getConfig().textLkSecretArn))],
    routing,
  );
  return factory;
}

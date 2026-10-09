import { DummySmsGateway } from './gateways/dummy-gateway.js';
import { SmsGatewayFactory } from './sms-gateway-factory.js';
import type { SmsRoutingTable } from './types.js';

export * from './types.js';
export { SmsGatewayFactory, UnsupportedCountryError } from './sms-gateway-factory.js';

/**
 * Country -> gateway routing. Only the dummy gateway exists so far, so everything goes to it.
 * When real providers are added, register them below and list each supported country here —
 * and drop `defaultGateway` so unlisted countries are rejected rather than sent to.
 */
const routing: SmsRoutingTable = {
  countries: {},
  defaultGateway: 'dummy',
};

let factory: SmsGatewayFactory | undefined;

/** Lazily built once per Lambda container. */
export function getSmsGatewayFactory(): SmsGatewayFactory {
  factory ??= new SmsGatewayFactory([new DummySmsGateway()], routing);
  return factory;
}

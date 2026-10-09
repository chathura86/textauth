import { describe, expect, it } from 'vitest';
import { SmsGatewayFactory, UnsupportedCountryError } from './sms-gateway-factory.js';
import type { SmsGateway } from './types.js';

function fakeGateway(name: string): SmsGateway {
  return { name, send: async () => ({ gateway: name, messageId: '1' }) };
}

const us = fakeGateway('us-provider');
const uk = fakeGateway('uk-provider');
const fallback = fakeGateway('fallback');

describe('SmsGatewayFactory', () => {
  it('routes by the phone number country', () => {
    const factory = new SmsGatewayFactory([us, uk], { countries: { US: 'us-provider', GB: 'uk-provider' } });

    expect(factory.forPhoneNumber('+12015550123')).toBe(us);
    expect(factory.forPhoneNumber('+447400123456')).toBe(uk);
  });

  it('falls back to the default gateway for unlisted countries', () => {
    const factory = new SmsGatewayFactory([us, fallback], {
      countries: { US: 'us-provider' },
      defaultGateway: 'fallback',
    });

    expect(factory.forPhoneNumber('+447400123456')).toBe(fallback);
  });

  it('rejects unlisted countries when there is no default', () => {
    const factory = new SmsGatewayFactory([us], { countries: { US: 'us-provider' } });

    expect(() => factory.forPhoneNumber('+447400123456')).toThrow(UnsupportedCountryError);
  });

  it('rejects numbers whose country cannot be determined', () => {
    const factory = new SmsGatewayFactory([us], { countries: { US: 'us-provider' } });

    expect(() => factory.forPhoneNumber('not a number')).toThrow(UnsupportedCountryError);
  });

  it('refuses a routing table that names an unregistered gateway', () => {
    expect(() => new SmsGatewayFactory([us], { countries: { GB: 'uk-provider' } })).toThrow(/unregistered/);
  });
});

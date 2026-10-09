import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import type { SmsGateway, SmsRoutingTable } from './types.js';

export class UnsupportedCountryError extends Error {
  constructor(readonly country: string | undefined) {
    super(`No SMS gateway is configured for country ${country ?? '(unknown)'}`);
    this.name = 'UnsupportedCountryError';
  }
}

/** Picks the SMS gateway for a phone number based on the number's country. */
export class SmsGatewayFactory {
  private readonly gateways: ReadonlyMap<string, SmsGateway>;

  constructor(
    gateways: readonly SmsGateway[],
    private readonly routing: SmsRoutingTable,
  ) {
    this.gateways = new Map(gateways.map((gateway) => [gateway.name, gateway]));

    // Fail at cold start rather than on some user's login when the table names a gateway
    // that was never registered.
    const referenced = [...Object.values(routing.countries), routing.defaultGateway];
    for (const name of referenced) {
      if (name !== undefined && !this.gateways.has(name)) {
        throw new Error(`SMS routing table references unregistered gateway "${name}"`);
      }
    }
  }

  /** @param e164 Phone number in E.164 form (the API normalises user input before this). */
  forPhoneNumber(e164: string): SmsGateway {
    return this.forCountry(parsePhoneNumberFromString(e164)?.country);
  }

  forCountry(country: CountryCode | undefined): SmsGateway {
    const name = (country && this.routing.countries[country]) ?? this.routing.defaultGateway;
    const gateway = name === undefined ? undefined : this.gateways.get(name);
    if (!gateway) {
      throw new UnsupportedCountryError(country);
    }
    return gateway;
  }
}

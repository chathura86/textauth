import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

export interface NormalizedPhone {
  /** E.164, e.g. +12015550123 — the only form we store or send to. */
  e164: string;
  country: CountryCode | undefined;
}

/**
 * Turns what the user typed into E.164. `defaultCountry` (from the UI's country picker) is
 * used for numbers typed without a +country prefix. Returns undefined for anything that
 * isn't a valid number, so we never pay to text garbage.
 */
export function normalizePhone(input: string, defaultCountry?: string): NormalizedPhone | undefined {
  const parsed = parsePhoneNumberFromString(input, {
    defaultCountry: defaultCountry?.toUpperCase() as CountryCode | undefined,
  });
  if (!parsed?.isValid()) return undefined;
  return { e164: parsed.number, country: parsed.country };
}

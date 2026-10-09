import { SMS_COUNTRIES, type SmsCountry } from '@textauth/shared';
import { getCountryCallingCode } from 'libphonenumber-js/min';

export interface Country {
  code: SmsCountry;
  name: string;
  callingCode: string;
}

const displayNames = new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' });

/** Only countries we have an SMS gateway for — there's no point offering the rest. */
export const COUNTRIES: Country[] = SMS_COUNTRIES.map((code) => ({
  code,
  name: displayNames.of(code) ?? code,
  callingCode: getCountryCallingCode(code),
})).sort((a, b) => a.name.localeCompare(b.name));

/** The user's country from the browser language (e.g. si-LK -> LK) if we support it, else the first one. */
export function guessCountry(): SmsCountry {
  for (const language of navigator.languages ?? [navigator.language]) {
    const region = new Intl.Locale(language).maximize().region;
    const match = COUNTRIES.find((country) => country.code === region);
    if (match) return match.code;
  }
  return COUNTRIES[0]!.code;
}

import { SMS_COUNTRIES, type SmsCountry } from '@textauth/shared';
import { getCountryCallingCode } from 'libphonenumber-js/min';

export interface Country {
  code: SmsCountry;
  name: string;
  callingCode: string;
  /** What the picker shows: just the prefix (+94), plus the country code if another country shares it (+1 US). */
  label: string;
}

const displayNames = new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' });

const callingCodes = SMS_COUNTRIES.map((code) => getCountryCallingCode(code));

/** Only countries we have an SMS gateway for — there's no point offering the rest. */
export const COUNTRIES: Country[] = SMS_COUNTRIES.map((code, i) => {
  const callingCode = callingCodes[i]!;
  const shared = callingCodes.filter((c) => c === callingCode).length > 1;
  return {
    code,
    name: displayNames.of(code) ?? code,
    callingCode,
    label: shared ? `+${callingCode} ${code}` : `+${callingCode}`,
  };
}).sort((a, b) => Number(a.callingCode) - Number(b.callingCode) || a.code.localeCompare(b.code));

/** The user's country from the browser language (e.g. si-LK -> LK) if we support it, else the first one. */
export function guessCountry(): SmsCountry {
  for (const language of navigator.languages ?? [navigator.language]) {
    const region = new Intl.Locale(language).maximize().region;
    const match = COUNTRIES.find((country) => country.code === region);
    if (match) return match.code;
  }
  return COUNTRIES[0]!.code;
}

import { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min';

export interface Country {
  code: CountryCode;
  name: string;
  callingCode: string;
}

const displayNames = new Intl.DisplayNames([navigator.language, 'en'], { type: 'region' });

export const COUNTRIES: Country[] = getCountries()
  .map((code) => ({ code, name: displayNames.of(code) ?? code, callingCode: getCountryCallingCode(code) }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Best guess at the user's country from the browser language (e.g. en-GB -> GB), else US. */
export function guessCountry(): CountryCode {
  for (const language of navigator.languages ?? [navigator.language]) {
    const region = new Intl.Locale(language).maximize().region;
    if (region && COUNTRIES.some((country) => country.code === region)) return region as CountryCode;
  }
  return 'US';
}

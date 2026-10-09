/**
 * Countries (ISO 3166-1 alpha-2) we can text a login code to — one entry per country that has
 * an SMS gateway. The login UI only offers these in its country picker, and the API's routing
 * table (services/api/src/sms/index.ts) must map every one of them to a gateway, which the
 * type checker enforces.
 *
 * Adding a country: add it here, then route it in sms/index.ts.
 */
export const SMS_COUNTRIES = ['LK'] as const;

export type SmsCountry = (typeof SMS_COUNTRIES)[number];

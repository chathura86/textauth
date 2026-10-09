/** Lambda environment, set by infrastructure/lib/textauth-app-stack.ts. */
export interface Config {
  tableName: string;
  /** Secret holding AppSecret (below). */
  appSecretArn: string;
  /** The shared lionsports Resend secret ({ resendApiKey }). */
  resendSecretArn: string;
  /** Where the login UI and API are served, e.g. https://textauth.lionsportsusa.com */
  publicBaseUrl: string;
  syntheticEmailDomain: string;
  emailFrom: string;
  /** Auth0's /login/callback URL(s) — the only redirect_uri values /oauth/authorize accepts. */
  allowedRedirectUris: string[];
}

/** JSON shape of the `lionsports/production/textauth` secret (created out-of-band, see README). */
export interface AppSecret {
  /** Credentials Auth0's custom social connection uses against /oauth/token. */
  auth0ClientId: string;
  auth0ClientSecret: string;
  recaptchaSecretKey: string;
  /** CloudFront sends this as x-origin-verify; requests without it bypassed CloudFront/WAF. */
  originVerifySecret: string;
  /** HMAC key for hashing OTP codes and tokens before they are stored. */
  hashKey: string;
}

let config: Config | undefined;

export function getConfig(): Config {
  config ??= {
    tableName: required('TABLE_NAME'),
    appSecretArn: required('APP_SECRET_ARN'),
    resendSecretArn: required('RESEND_SECRET_ARN'),
    publicBaseUrl: required('PUBLIC_BASE_URL'),
    syntheticEmailDomain: required('SYNTHETIC_EMAIL_DOMAIN'),
    emailFrom: required('EMAIL_FROM'),
    allowedRedirectUris: required('ALLOWED_REDIRECT_URIS').split(','),
  };
  return config;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

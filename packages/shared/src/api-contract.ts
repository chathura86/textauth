/**
 * Request/response shapes for the login UI <-> API calls (`/api/*`). Shared so the static
 * UI and the Lambdas can't drift apart. The OAuth endpoints (`/oauth/*`) are called by
 * Auth0, not the UI, so they follow the OAuth 2.0 spec instead of living here.
 *
 * Every call carries `tx`, the login transaction id `/oauth/authorize` put in the UI's URL.
 */

export interface OtpStartRequest {
  tx: string;
  /** As typed by the user; the API normalises it to E.164. */
  phone: string;
  /** ISO 3166-1 alpha-2 country picked in the UI, used to parse numbers without a +prefix. */
  country?: string;
  recaptchaToken: string;
}

export interface OtpStartResponse {
  /** Seconds before the UI may offer "resend code". */
  resendAfterSeconds: number;
}

export interface OtpVerifyRequest {
  tx: string;
  code: string;
}

export interface EmailSubmitRequest {
  tx: string;
  email: string;
}

export interface EmailVerifyRequest {
  tx: string;
  code: string;
}

export interface SkipEmailRequest {
  tx: string;
}

/**
 * What the UI should do next. Returned by every step so the server owns the flow — e.g. a
 * returning user who already has an email goes straight from `otp/verify` to `done`.
 */
export type NextStep =
  | { step: 'email' }
  | { step: 'email-verify'; email: string }
  | { step: 'done'; redirectUrl: string };

export interface ApiError {
  error: ApiErrorCode;
  message: string;
}

export type ApiErrorCode =
  | 'invalid_request'
  | 'invalid_transaction'
  | 'invalid_phone'
  | 'unsupported_country'
  | 'captcha_failed'
  | 'rate_limited'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'email_in_use'
  | 'not_implemented'
  | 'internal_error';

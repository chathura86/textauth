import type {
  ApiError,
  EmailSubmitRequest,
  EmailVerifyRequest,
  NextStep,
  OtpStartRequest,
  OtpStartResponse,
  OtpVerifyRequest,
  SkipEmailRequest,
} from '@textauth/shared';

/** An API error the UI shows to the user as-is (the API writes its messages for people). */
export class ApiRequestError extends Error {
  constructor(readonly code: ApiError['error'], message: string) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiRequestError('internal_error', 'Could not reach the server. Check your connection and try again.');
  }
  const data = (await response.json().catch(() => undefined)) as T | ApiError | undefined;
  if (!response.ok || !data) {
    const error = data as ApiError | undefined;
    throw new ApiRequestError(error?.error ?? 'internal_error', error?.message ?? 'Something went wrong. Please try again.');
  }
  return data as T;
}

export const api = {
  startOtp: (request: OtpStartRequest) => post<OtpStartResponse>('/api/otp/start', request),
  verifyOtp: (request: OtpVerifyRequest) => post<NextStep>('/api/otp/verify', request),
  submitEmail: (request: EmailSubmitRequest) => post<NextStep>('/api/email', request),
  verifyEmail: (request: EmailVerifyRequest) => post<NextStep>('/api/email/verify', request),
  skipEmail: (request: SkipEmailRequest) => post<NextStep>('/api/email/skip', request),
};

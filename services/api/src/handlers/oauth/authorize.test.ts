import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpEvent } from '../../lib/http.js';
import { createLoginTransaction } from '../../store/login-transactions.js';
import { authorize } from './authorize.js';

vi.mock('../../lib/config.js', () => ({
  getConfig: () => ({
    publicBaseUrl: 'https://textauth.example.com',
    allowedRedirectUris: ['https://tenant.auth0.com/login/callback'],
  }),
}));
vi.mock('../../lib/secrets.js', () => ({
  getAppSecret: async () => ({ auth0ClientId: 'auth0' }),
}));
vi.mock('../../store/login-transactions.js', () => ({
  createLoginTransaction: vi.fn(async () => ({ id: 'tx123' })),
}));

const valid = {
  response_type: 'code',
  client_id: 'auth0',
  redirect_uri: 'https://tenant.auth0.com/login/callback',
  state: 'abc',
  scope: 'openid phone',
};

function request(params: Record<string, string | undefined>): HttpEvent {
  return { queryStringParameters: params } as unknown as HttpEvent;
}

function location(result: Awaited<ReturnType<typeof authorize>>): URL {
  expect(result.statusCode).toBe(302);
  return new URL(String(result.headers?.location));
}

describe('GET /oauth/authorize', () => {
  beforeEach(() => vi.mocked(createLoginTransaction).mockClear());

  it('stores the request and sends the user to the login UI', async () => {
    const url = location(await authorize(request(valid)));

    expect(url.origin + url.pathname).toBe('https://textauth.example.com/');
    expect(url.searchParams.get('tx')).toBe('tx123');
    expect(createLoginTransaction).toHaveBeenCalledWith({
      clientId: 'auth0',
      redirectUri: valid.redirect_uri,
      state: 'abc',
      scope: 'openid phone',
      codeChallenge: undefined,
    });
  });

  it('keeps an S256 PKCE challenge', async () => {
    await authorize(request({ ...valid, code_challenge: 'xyz', code_challenge_method: 'S256' }));

    expect(createLoginTransaction).toHaveBeenCalledWith(expect.objectContaining({ codeChallenge: 'xyz' }));
  });

  it.each([
    ['an unknown redirect_uri', { redirect_uri: 'https://evil.example.com/cb' }],
    ['a missing redirect_uri', { redirect_uri: undefined }],
    ['an unknown client_id', { client_id: 'someone-else' }],
  ])('shows an error page instead of redirecting for %s', async (_, override) => {
    const result = await authorize(request({ ...valid, ...override }));

    expect(result.statusCode).toBe(400);
    expect(result.headers?.location).toBeUndefined();
    expect(createLoginTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['response_type other than code', { response_type: 'token' }, 'unsupported_response_type'],
    ['a missing state', { state: undefined }, 'invalid_request'],
    ['a plain PKCE challenge', { code_challenge: 'xyz', code_challenge_method: 'plain' }, 'invalid_request'],
  ])('reports %s back to Auth0', async (_, override, error) => {
    const url = location(await authorize(request({ ...valid, ...override })));

    expect(url.origin + url.pathname).toBe(valid.redirect_uri);
    expect(url.searchParams.get('error')).toBe(error);
    expect(createLoginTransaction).not.toHaveBeenCalled();
  });

  it('echoes state on errors', async () => {
    const url = location(await authorize(request({ ...valid, response_type: 'token' })));

    expect(url.searchParams.get('state')).toBe('abc');
  });
});

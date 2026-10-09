import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpEvent } from '../../lib/http.js';
import { createAccessToken } from '../../store/access-tokens.js';
import { consumeAuthorizationCode, type AuthorizationCode } from '../../store/authorization-codes.js';
import { token } from './token.js';

vi.mock('../../lib/secrets.js', () => ({
  getAppSecret: async () => ({ auth0ClientId: 'auth0', auth0ClientSecret: 's3cret' }),
}));
vi.mock('../../store/authorization-codes.js', () => ({ consumeAuthorizationCode: vi.fn() }));
vi.mock('../../store/access-tokens.js', () => ({
  ACCESS_TOKEN_TTL_SECONDS: 3600,
  createAccessToken: vi.fn(async () => 'access-1'),
}));

const REDIRECT_URI = 'https://t.auth0.com/login/callback';
const grant: AuthorizationCode = { userId: 'user1', clientId: 'auth0', redirectUri: REDIRECT_URI, scope: 'openid' };

const form = {
  grant_type: 'authorization_code',
  code: 'code-1',
  redirect_uri: REDIRECT_URI,
  client_id: 'auth0',
  client_secret: 's3cret',
};

function request(body: Record<string, string>, headers: Record<string, string> = {}): HttpEvent {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: new URLSearchParams(body).toString(),
  } as unknown as HttpEvent;
}

async function call(event: HttpEvent) {
  const result = await token(event);
  return { status: result.statusCode, headers: result.headers ?? {}, body: JSON.parse(String(result.body)) };
}

describe('POST /oauth/token', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeAuthorizationCode).mockResolvedValue(grant);
  });

  it('exchanges a code for an access token', async () => {
    const { status, headers, body } = await call(request(form));

    expect(status).toBe(200);
    expect(body).toEqual({ access_token: 'access-1', token_type: 'Bearer', expires_in: 3600, scope: 'openid' });
    expect(headers['cache-control']).toBe('no-store');
    expect(consumeAuthorizationCode).toHaveBeenCalledWith('code-1');
    expect(createAccessToken).toHaveBeenCalledWith({ userId: 'user1', clientId: 'auth0', scope: 'openid' });
  });

  it('accepts HTTP Basic client authentication', async () => {
    const { client_id: _id, client_secret: _secret, ...rest } = form;
    const basic = Buffer.from('auth0:s3cret').toString('base64');

    expect((await call(request(rest, { authorization: `Basic ${basic}` }))).status).toBe(200);
  });

  it('accepts a JSON body', async () => {
    const event = { headers: { 'content-type': 'application/json' }, body: JSON.stringify(form) } as unknown as HttpEvent;

    expect((await call(event)).status).toBe(200);
  });

  it.each([
    ['a wrong secret', { client_secret: 'nope' }],
    ['a wrong client_id', { client_id: 'other' }],
    ['no credentials', { client_id: '', client_secret: '' }],
  ])('rejects %s before touching the code', async (_, override) => {
    const { status, body } = await call(request({ ...form, ...override }));

    expect([status, body.error]).toEqual([401, 'invalid_client']);
    expect(consumeAuthorizationCode).not.toHaveBeenCalled();
  });

  it('rejects other grant types', async () => {
    expect((await call(request({ ...form, grant_type: 'password' }))).body.error).toBe('unsupported_grant_type');
  });

  it('rejects an unknown, expired or used code', async () => {
    vi.mocked(consumeAuthorizationCode).mockResolvedValue(undefined);

    const { status, body } = await call(request(form));
    expect([status, body.error]).toEqual([400, 'invalid_grant']);
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a redirect_uri that differs from the authorization request', async () => {
    expect((await call(request({ ...form, redirect_uri: 'https://other/cb' }))).body.error).toBe('invalid_grant');
    expect(createAccessToken).not.toHaveBeenCalled();
  });

  describe('with PKCE', () => {
    const verifier = 'a'.repeat(64);
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    beforeEach(() => {
      vi.mocked(consumeAuthorizationCode).mockResolvedValue({ ...grant, codeChallenge: challenge });
    });

    it('accepts the matching verifier', async () => {
      expect((await call(request({ ...form, code_verifier: verifier }))).status).toBe(200);
    });

    it.each([
      ['a wrong verifier', { code_verifier: 'b'.repeat(64) }],
      ['a missing verifier', {}],
    ])('rejects %s', async (_, override) => {
      expect((await call(request({ ...form, ...override }))).body.error).toBe('invalid_grant');
      expect(createAccessToken).not.toHaveBeenCalled();
    });
  });
});

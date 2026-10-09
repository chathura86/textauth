import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpEvent } from '../../lib/http.js';
import { getAccessToken } from '../../store/access-tokens.js';
import { findUserById } from '../../store/users.js';
import { userinfo } from './userinfo.js';

vi.mock('../../store/access-tokens.js', () => ({ getAccessToken: vi.fn() }));
vi.mock('../../store/users.js', () => ({ findUserById: vi.fn() }));

function request(authorization?: string): HttpEvent {
  return { headers: authorization ? { authorization } : {} } as unknown as HttpEvent;
}

async function call(event: HttpEvent) {
  const result = await userinfo(event);
  return { status: result.statusCode, headers: result.headers ?? {}, body: JSON.parse(String(result.body)) };
}

describe('GET /oauth/userinfo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAccessToken).mockResolvedValue({ userId: 'user1', clientId: 'auth0' });
    vi.mocked(findUserById).mockResolvedValue({
      id: 'user1',
      phone: '+12015550123',
      email: 'u_abc1234567@users.textauth.lionsportsusa.com',
      emailSource: 'synthetic',
      createdAt: 0,
      updatedAt: 0,
    });
  });

  it('returns the profile for a valid token', async () => {
    const { status, body } = await call(request('Bearer access-1'));

    expect(status).toBe(200);
    expect(body).toEqual({
      sub: 'user1',
      email: 'u_abc1234567@users.textauth.lionsportsusa.com',
      email_verified: true,
      phone_number: '+12015550123',
      phone_number_verified: true,
    });
    expect(getAccessToken).toHaveBeenCalledWith('access-1');
  });

  it.each([
    ['no Authorization header', undefined],
    ['a non-Bearer scheme', 'Basic abc'],
  ])('rejects %s', async (_, authorization) => {
    const { status, headers, body } = await call(request(authorization));

    expect([status, body.error]).toEqual([401, 'invalid_token']);
    expect(headers['www-authenticate']).toContain('invalid_token');
  });

  it('rejects an unknown or expired token', async () => {
    vi.mocked(getAccessToken).mockResolvedValue(undefined);

    expect((await call(request('Bearer nope'))).status).toBe(401);
  });

  it('rejects a token whose user no longer exists', async () => {
    vi.mocked(findUserById).mockResolvedValue(undefined);

    expect((await call(request('Bearer access-1'))).status).toBe(401);
  });
});

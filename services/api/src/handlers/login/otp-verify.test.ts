import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeLogin } from '../../lib/complete-login.js';
import { hmac } from '../../lib/hash.js';
import type { HttpEvent } from '../../lib/http.js';
import {
  advanceLoginTransaction,
  getLoginTransaction,
  recordCodeAttempt,
  type LoginTransaction,
} from '../../store/login-transactions.js';
import { findUserByPhone, type User } from '../../store/users.js';
import { otpVerify } from './otp-verify.js';

vi.mock('../../lib/secrets.js', () => ({ getAppSecret: async () => ({ hashKey: 'test-key' }) }));
vi.mock('../../lib/complete-login.js', () => ({
  completeLogin: vi.fn(async () => 'https://t.auth0.com/login/callback?code=c&state=s'),
}));
vi.mock('../../store/login-transactions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/login-transactions.js')>()),
  getLoginTransaction: vi.fn(),
  recordCodeAttempt: vi.fn(async () => true),
  advanceLoginTransaction: vi.fn(async () => undefined),
}));
vi.mock('../../store/users.js', () => ({ findUserByPhone: vi.fn(async () => undefined) }));

const NOW = 1_800_000_000;
const CODE = '123456';

async function tx(overrides: Partial<LoginTransaction> = {}): Promise<LoginTransaction> {
  return {
    id: 'tx1',
    step: 'otp',
    oauth: { clientId: 'auth0', redirectUri: 'https://t.auth0.com/login/callback', state: 's' },
    createdAt: NOW,
    expiresAt: NOW + 900,
    phone: '+12015550123',
    otpHash: await hmac('otp:tx1', CODE),
    otpExpiresAt: NOW + 600,
    otpAttempts: 0,
    ...overrides,
  };
}

async function call(body: Record<string, unknown>) {
  const result = await otpVerify({ body: JSON.stringify(body) } as unknown as HttpEvent);
  return { status: result.statusCode, body: JSON.parse(String(result.body)) };
}

describe('POST /api/otp/verify', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW * 1000 });
    vi.mocked(getLoginTransaction).mockResolvedValue(await tx());
    vi.mocked(recordCodeAttempt).mockResolvedValue(true);
    vi.mocked(advanceLoginTransaction).mockResolvedValue(undefined);
    vi.mocked(findUserByPhone).mockResolvedValue(undefined);
  });

  it('sends a new user on to the email step', async () => {
    const { status, body } = await call({ tx: 'tx1', code: CODE });

    expect([status, body]).toEqual([200, { step: 'email' }]);
    expect(advanceLoginTransaction).toHaveBeenCalledWith('tx1', 'otp', 'email');
  });

  it('finishes the login for a returning user', async () => {
    vi.mocked(findUserByPhone).mockResolvedValue({ id: 'user1' } as User);

    const { body } = await call({ tx: 'tx1', code: CODE });

    expect(body).toEqual({ step: 'done', redirectUrl: 'https://t.auth0.com/login/callback?code=c&state=s' });
    expect(completeLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx1' }), 'otp', 'user1');
  });

  it('accepts a code typed with spaces', async () => {
    expect((await call({ tx: 'tx1', code: '123 456' })).status).toBe(200);
  });

  it('rejects a wrong code, counting the attempt', async () => {
    const { status, body } = await call({ tx: 'tx1', code: '654321' });

    expect([status, body.error]).toEqual([400, 'invalid_code']);
    expect(recordCodeAttempt).toHaveBeenCalledWith('tx1', 'otp', 5);
    expect(advanceLoginTransaction).not.toHaveBeenCalled();
  });

  it('stops guessing once attempts are used up, even with the right code', async () => {
    vi.mocked(recordCodeAttempt).mockResolvedValue(false);

    const { status, body } = await call({ tx: 'tx1', code: CODE });

    expect([status, body.error]).toEqual([429, 'too_many_attempts']);
    expect(advanceLoginTransaction).not.toHaveBeenCalled();
  });

  it('rejects an expired code', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(await tx({ otpExpiresAt: NOW }));

    expect((await call({ tx: 'tx1', code: CODE })).body.error).toBe('invalid_code');
    expect(recordCodeAttempt).not.toHaveBeenCalled();
  });

  it('rejects a transaction that is not waiting for a code', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(await tx({ step: 'phone' }));

    expect((await call({ tx: 'tx1', code: CODE })).body.error).toBe('invalid_transaction');
  });

  it('lets only one of two parallel correct submissions through', async () => {
    vi.mocked(advanceLoginTransaction).mockRejectedValue(
      new ConditionalCheckFailedException({ message: 'conditional', $metadata: {} }),
    );

    const { status, body } = await call({ tx: 'tx1', code: CODE });
    expect([status, body.error]).toEqual([409, 'invalid_transaction']);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { completeLogin } from '../../lib/complete-login.js';
import { hmac } from '../../lib/hash.js';
import type { HttpEvent, HttpResult } from '../../lib/http.js';
import {
  getLoginTransaction,
  recordCodeAttempt,
  recordCodeSent,
  type LoginTransaction,
} from '../../store/login-transactions.js';
import { consumeRateLimit } from '../../store/rate-limits.js';
import { createUser, isEmailTaken, UserConflictError, type User } from '../../store/users.js';
import { emailSkip } from './email-skip.js';
import { emailSubmit } from './email-submit.js';
import { emailVerify } from './email-verify.js';

const sendEmail = vi.fn(async () => ({ id: 'resend-1' }));
const SYNTHETIC_DOMAIN = 'users.textauth.example.com';

vi.mock('../../lib/secrets.js', () => ({ getAppSecret: async () => ({ hashKey: 'test-key' }) }));
vi.mock('../../lib/config.js', () => ({ getConfig: () => ({ syntheticEmailDomain: SYNTHETIC_DOMAIN }) }));
vi.mock('../../email/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../email/index.js')>()),
  getEmailSender: async () => ({ send: sendEmail }),
}));
vi.mock('../../lib/complete-login.js', () => ({ completeLogin: vi.fn() }));
vi.mock('../../store/rate-limits.js', () => ({ consumeRateLimit: vi.fn() }));
vi.mock('../../store/login-transactions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/login-transactions.js')>()),
  getLoginTransaction: vi.fn(),
  recordCodeSent: vi.fn(),
  recordCodeAttempt: vi.fn(),
}));
vi.mock('../../store/users.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/users.js')>()),
  isEmailTaken: vi.fn(),
  createUser: vi.fn(),
}));

const NOW = 1_800_000_000;
const CODE = '123456';
const REDIRECT = 'https://t.auth0.com/login/callback?code=c&state=s';

function tx(overrides: Partial<LoginTransaction> = {}): LoginTransaction {
  return {
    id: 'tx1',
    step: 'email',
    oauth: { clientId: 'auth0', redirectUri: 'https://t.auth0.com/login/callback', state: 's' },
    createdAt: NOW,
    expiresAt: NOW + 900,
    phone: '+12015550123',
    ...overrides,
  };
}

async function waitingForEmailCode(overrides: Partial<LoginTransaction> = {}) {
  return tx({
    step: 'email-verify',
    pendingEmail: 'Jane@Example.com',
    emailCodeHash: await hmac('email:tx1', CODE),
    emailCodeSentAt: NOW - 60,
    emailCodeExpiresAt: NOW + 540,
    emailCodeAttempts: 0,
    emailCodeSendCount: 1,
    ...overrides,
  });
}

async function call(handler: (e: HttpEvent) => Promise<HttpResult>, body: Record<string, unknown>) {
  const result = await handler({ body: JSON.stringify(body) } as unknown as HttpEvent);
  return { status: result.statusCode, body: JSON.parse(String(result.body)) };
}

function createdUser(input: Pick<User, 'phone' | 'email' | 'emailSource'>): User {
  return { id: 'user1', ...input, createdAt: NOW, updatedAt: NOW };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: NOW * 1000 });
  vi.mocked(getLoginTransaction).mockResolvedValue(tx());
  vi.mocked(recordCodeSent).mockResolvedValue(true);
  vi.mocked(recordCodeAttempt).mockResolvedValue(true);
  vi.mocked(consumeRateLimit).mockResolvedValue(true);
  vi.mocked(isEmailTaken).mockResolvedValue(false);
  vi.mocked(createUser).mockImplementation(async (input) => createdUser(input));
  vi.mocked(completeLogin).mockResolvedValue(REDIRECT);
});

describe('POST /api/email', () => {
  it('emails a code and moves to email-verify', async () => {
    const { status, body } = await call(emailSubmit, { tx: 'tx1', email: 'jane@example.com' });

    expect([status, body]).toEqual([200, { step: 'email-verify', email: 'jane@example.com' }]);
    expect(recordCodeSent).toHaveBeenCalledWith(
      'tx1',
      'email',
      expect.objectContaining({ target: 'jane@example.com' }),
      expect.anything(),
    );
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jane@example.com', text: expect.stringMatching(/code is \d{6}/) }),
    );
  });

  it('refuses an email that belongs to another user', async () => {
    vi.mocked(isEmailTaken).mockResolvedValue(true);

    const { status, body } = await call(emailSubmit, { tx: 'tx1', email: 'jane@example.com' });
    expect([status, body.error]).toEqual([409, 'email_in_use']);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it.each(['not-an-email', `u_abc@${SYNTHETIC_DOMAIN}`])('rejects %s', async (email) => {
    expect((await call(emailSubmit, { tx: 'tx1', email })).body.error).toBe('invalid_request');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('allows changing the address from the email-verify step', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(await waitingForEmailCode());

    expect((await call(emailSubmit, { tx: 'tx1', email: 'other@example.com' })).status).toBe(200);
  });

  it('rejects a login that has not verified its phone yet', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(tx({ step: 'otp' }));

    expect((await call(emailSubmit, { tx: 'tx1', email: 'jane@example.com' })).body.error).toBe('invalid_transaction');
  });

  it('limits codes per address', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue(false);

    expect((await call(emailSubmit, { tx: 'tx1', email: 'Jane@Example.com' })).status).toBe(429);
    expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'email:jane@example.com' }));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('enforces the resend cooldown', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(await waitingForEmailCode({ emailCodeSentAt: NOW - 5 }));

    expect((await call(emailSubmit, { tx: 'tx1', email: 'jane@example.com' })).status).toBe(429);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('POST /api/email/verify', () => {
  beforeEach(async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(await waitingForEmailCode());
  });

  it('creates the account with the verified email and finishes the login', async () => {
    const { status, body } = await call(emailVerify, { tx: 'tx1', code: CODE });

    expect([status, body]).toEqual([200, { step: 'done', redirectUrl: REDIRECT }]);
    expect(createUser).toHaveBeenCalledWith({ phone: '+12015550123', email: 'Jane@Example.com', emailSource: 'user' });
    expect(completeLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx1' }), 'email-verify', 'user1');
  });

  it('rejects a wrong code without creating anything', async () => {
    const { status, body } = await call(emailVerify, { tx: 'tx1', code: '000000' });

    expect([status, body.error]).toEqual([400, 'invalid_code']);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('stops after too many guesses', async () => {
    vi.mocked(recordCodeAttempt).mockResolvedValue(false);

    expect((await call(emailVerify, { tx: 'tx1', code: CODE })).body.error).toBe('too_many_attempts');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('reports an email claimed by someone else in the meantime', async () => {
    vi.mocked(createUser).mockRejectedValue(new UserConflictError('email'));

    const { status, body } = await call(emailVerify, { tx: 'tx1', code: CODE });
    expect([status, body.error]).toEqual([409, 'email_in_use']);
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('refuses when the phone got an account in a parallel login', async () => {
    vi.mocked(createUser).mockRejectedValue(new UserConflictError('phone'));

    expect((await call(emailVerify, { tx: 'tx1', code: CODE })).body.error).toBe('invalid_transaction');
  });
});

describe('POST /api/email/skip', () => {
  it('creates the account with a synthetic email and finishes the login', async () => {
    const { status, body } = await call(emailSkip, { tx: 'tx1' });

    expect([status, body]).toEqual([200, { step: 'done', redirectUrl: REDIRECT }]);
    expect(createUser).toHaveBeenCalledWith({
      phone: '+12015550123',
      email: expect.stringMatching(new RegExp(`^u_[a-z0-9]{10}@${SYNTHETIC_DOMAIN.replaceAll('.', '\\.')}$`)),
      emailSource: 'synthetic',
    });
    expect(completeLogin).toHaveBeenCalledWith(expect.anything(), 'email', 'user1');
  });

  it('works from the email-verify step too', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(await waitingForEmailCode());

    await call(emailSkip, { tx: 'tx1' });
    expect(completeLogin).toHaveBeenCalledWith(expect.anything(), 'email-verify', 'user1');
  });

  it('retries with a fresh address if the synthetic one collides', async () => {
    vi.mocked(createUser)
      .mockRejectedValueOnce(new UserConflictError('email'))
      .mockImplementationOnce(async (input) => createdUser(input));

    expect((await call(emailSkip, { tx: 'tx1' })).status).toBe(200);
    const [first, second] = vi.mocked(createUser).mock.calls.map(([input]) => input.email);
    expect(first).not.toBe(second);
  });

  it('rejects a login that has not verified its phone yet', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(tx({ step: 'otp' }));

    expect((await call(emailSkip, { tx: 'tx1' })).body.error).toBe('invalid_transaction');
    expect(createUser).not.toHaveBeenCalled();
  });
});

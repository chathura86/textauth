import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HttpEvent } from '../../lib/http.js';
import { verifyRecaptcha } from '../../lib/recaptcha.js';
import { getLoginTransaction, recordCodeSent, type LoginTransaction } from '../../store/login-transactions.js';
import { consumeRateLimit } from '../../store/rate-limits.js';
import { otpStart } from './otp-start.js';

const send = vi.fn(async () => ({ gateway: 'fake', messageId: 'm1' }));

vi.mock('../../lib/secrets.js', () => ({ getAppSecret: async () => ({ hashKey: 'test-key' }) }));
vi.mock('../../lib/recaptcha.js', () => ({ verifyRecaptcha: vi.fn(async () => true) }));
vi.mock('../../store/login-transactions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../store/login-transactions.js')>()),
  getLoginTransaction: vi.fn(),
  recordCodeSent: vi.fn(async () => true),
}));
vi.mock('../../store/rate-limits.js', () => ({ consumeRateLimit: vi.fn(async () => true) }));
vi.mock('../../sms/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../sms/index.js')>();
  return {
    ...actual,
    getSmsGatewayFactory: () =>
      new actual.SmsGatewayFactory([{ name: 'fake', send }], { countries: { US: 'fake', GB: 'fake' } }),
  };
});

const NOW = 1_800_000_000;

function tx(overrides: Partial<LoginTransaction> = {}): LoginTransaction {
  return {
    id: 'tx1',
    step: 'phone',
    oauth: { clientId: 'auth0', redirectUri: 'https://t.auth0.com/login/callback', state: 's' },
    createdAt: NOW,
    expiresAt: NOW + 900,
    ...overrides,
  };
}

function request(body: Record<string, unknown>): HttpEvent {
  return { body: JSON.stringify(body) } as unknown as HttpEvent;
}

const valid = { tx: 'tx1', phone: '+12015550123', recaptchaToken: 'token' };

async function call(body: Record<string, unknown> = valid) {
  const result = await otpStart(request(body));
  return { status: result.statusCode, body: JSON.parse(String(result.body)) };
}

describe('POST /api/otp/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: NOW * 1000 });
    vi.mocked(getLoginTransaction).mockResolvedValue(tx());
    vi.mocked(verifyRecaptcha).mockResolvedValue(true);
    vi.mocked(consumeRateLimit).mockResolvedValue(true);
    vi.mocked(recordCodeSent).mockResolvedValue(true);
  });

  it('records a code and texts it to the normalised number', async () => {
    const { status, body } = await call({ ...valid, phone: '(201) 555-0123', country: 'US' });

    expect(status).toBe(200);
    expect(body).toEqual({ resendAfterSeconds: 30 });
    expect(verifyRecaptcha).toHaveBeenCalledWith('token', 'otp_start');
    expect(recordCodeSent).toHaveBeenCalledWith(
      'tx1',
      'otp',
      expect.objectContaining({ target: '+12015550123', expiresAt: NOW + 600 }),
      { maxSends: 3, resendAfterSeconds: 30 },
    );
    expect(send).toHaveBeenCalledWith({ to: '+12015550123', body: expect.stringMatching(/^\d{6} is your/) });
  });

  it('stores only a hash of the code', async () => {
    await call();

    const sms = send.mock.calls[0] as unknown as [{ body: string }];
    const code = sms[0].body.slice(0, 6);
    const recorded = vi.mocked(recordCodeSent).mock.calls[0]![2];
    expect(recorded.hash).not.toContain(code);
  });

  it('rejects a missing field', async () => {
    expect((await call({ tx: 'tx1', phone: '+12015550123' })).body.error).toBe('invalid_request');
  });

  it.each([
    ['unknown or expired', undefined],
    ['already past the code step', tx({ step: 'email' })],
  ])('rejects a transaction that is %s', async (_, transaction) => {
    vi.mocked(getLoginTransaction).mockResolvedValue(transaction);

    expect((await call()).body.error).toBe('invalid_transaction');
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects a failed reCAPTCHA before touching rate limits or sending', async () => {
    vi.mocked(verifyRecaptcha).mockResolvedValue(false);

    expect((await call()).body.error).toBe('captcha_failed');
    expect(consumeRateLimit).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects an invalid number', async () => {
    expect((await call({ ...valid, phone: '12345' })).body.error).toBe('invalid_phone');
  });

  it('rejects a country with no gateway', async () => {
    // Valid French mobile; the routing table above only has US and GB.
    expect((await call({ ...valid, phone: '+33612345678' })).body.error).toBe('unsupported_country');
    expect(send).not.toHaveBeenCalled();
  });

  it('enforces the resend cooldown', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(tx({ step: 'otp', otpSentAt: NOW - 10, otpSendCount: 1 }));

    const { status, body } = await call();
    expect([status, body.error]).toEqual([429, 'rate_limited']);
    expect(send).not.toHaveBeenCalled();
  });

  it('caps codes per transaction', async () => {
    vi.mocked(getLoginTransaction).mockResolvedValue(tx({ step: 'otp', otpSentAt: NOW - 60, otpSendCount: 3 }));

    expect((await call()).status).toBe(429);
    expect(send).not.toHaveBeenCalled();
  });

  it('applies per-phone and per-country limits', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    expect((await call()).status).toBe(429);
    expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'phone:+12015550123' }));
    expect(consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({ key: 'country:US' }));
    expect(send).not.toHaveBeenCalled();
  });

  it('does not send when a parallel request already recorded a code', async () => {
    vi.mocked(recordCodeSent).mockResolvedValue(false);

    expect((await call()).status).toBe(429);
    expect(send).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextLkSmsGateway } from './textlk-gateway.js';

const fetchMock = vi.fn<typeof fetch>();

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

const gateway = new TextLkSmsGateway(async () => ({ apiToken: 'tok', senderId: 'LionSports' }));

describe('TextLkSmsGateway', () => {
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('sends through the v3 API with a bearer token and the number without +', async () => {
    respond(200, { status: 'success', data: { uid: 'abc123' } });

    const result = await gateway.send({ to: '+94771234567', body: 'hello' });

    expect(result).toEqual({ gateway: 'textlk', messageId: 'abc123' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://app.text.lk/api/v3/sms/send');
    expect(new Headers(init!.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(init!.body))).toEqual({
      recipient: '94771234567',
      sender_id: 'LionSports',
      type: 'plain',
      message: 'hello',
    });
  });

  it('fails on an error status in the body, even with HTTP 200', async () => {
    respond(200, { status: 'error', message: 'Insufficient balance' });

    await expect(gateway.send({ to: '+94771234567', body: 'hi' })).rejects.toThrow(/Insufficient balance/);
  });

  it('fails on an HTTP error', async () => {
    respond(401, { message: 'Unauthenticated.' });

    await expect(gateway.send({ to: '+94771234567', body: 'hi' })).rejects.toThrow(/HTTP 401/);
  });

  it('never puts the token in the error', async () => {
    respond(500, { status: 'error', message: 'boom' });

    await expect(gateway.send({ to: '+94771234567', body: 'hi' })).rejects.not.toThrow(/tok/);
  });
});

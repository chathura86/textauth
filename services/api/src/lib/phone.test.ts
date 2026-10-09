import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it('accepts international format', () => {
    expect(normalizePhone('+1 (201) 555-0123')).toEqual({ e164: '+12015550123', country: 'US' });
  });

  it('uses the picked country for national format', () => {
    expect(normalizePhone('07400 123456', 'gb')).toEqual({ e164: '+447400123456', country: 'GB' });
  });

  it('prefers the number’s own +prefix over the picked country', () => {
    expect(normalizePhone('+447400123456', 'US')?.country).toBe('GB');
  });

  it.each(['12345', 'not a number', '+1 000 000 0000'])('rejects %s', (input) => {
    expect(normalizePhone(input, 'US')).toBeUndefined();
  });
});

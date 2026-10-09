import { describe, expect, it } from 'vitest';
import { generateSyntheticEmail, isSyntheticEmail } from './synthetic-email.js';

const DOMAIN = 'users.textauth.lionsportsusa.com';

describe('generateSyntheticEmail', () => {
  it('uses the u_<random>@domain pattern', () => {
    expect(generateSyntheticEmail(DOMAIN)).toMatch(/^u_[a-z0-9]{10}@users\.textauth\.lionsportsusa\.com$/);
  });

  it('does not repeat itself', () => {
    const emails = new Set(Array.from({ length: 1000 }, () => generateSyntheticEmail(DOMAIN)));
    expect(emails.size).toBe(1000);
  });
});

describe('isSyntheticEmail', () => {
  it('recognises addresses on the synthetic domain only', () => {
    expect(isSyntheticEmail('u_abc@USERS.textauth.lionsportsusa.com', DOMAIN)).toBe(true);
    expect(isSyntheticEmail('someone@lionsportsusa.com', DOMAIN)).toBe(false);
  });
});

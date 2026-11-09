import { describe, expect, test } from 'vitest';
import { isCrossSiteWrite, ownerCookie } from '../../../server/http/security.ts';

describe('ownerCookie', () => {
  test('plain-HTTP localhost uses SameSite=Lax without Secure', () => {
    const c = ownerCookie('o', 'abc', { host: 'localhost:3000' });
    expect(c).toContain('SameSite=Lax');
    expect(c).not.toContain('Secure');
    expect(c).toContain('HttpOnly');
  });
  test('public hosts (including preview iframes behind a proxy) use SameSite=None; Secure', () => {
    expect(ownerCookie('o', 'abc', { host: 'checkers.manus.space' })).toContain('SameSite=None; Secure');
    expect(ownerCookie('o', 'abc', { host: '10.0.0.5:8080', 'x-forwarded-host': 'x.manus.computer' })).toContain('SameSite=None; Secure');
    expect(ownerCookie('o', 'abc', { host: 'localhost:3000', 'x-forwarded-proto': 'https' })).toContain('SameSite=None; Secure');
  });
});

describe('isCrossSiteWrite', () => {
  test('trusts Sec-Fetch-Site when present, even if a proxy rewrote Host', () => {
    expect(isCrossSiteWrite({ 'sec-fetch-site': 'same-origin', origin: 'https://a.manus.space', host: '10.0.0.5:3000' })).toBe(false);
    expect(isCrossSiteWrite({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example', host: 'a.manus.space' })).toBe(true);
    expect(isCrossSiteWrite({ 'sec-fetch-site': 'same-site', host: 'a.manus.space' })).toBe(true);
    expect(isCrossSiteWrite({ 'sec-fetch-site': 'none' })).toBe(false);
  });
  test('falls back to Origin vs Host or X-Forwarded-Host', () => {
    expect(isCrossSiteWrite({ origin: 'https://evil.example', host: 'localhost' })).toBe(true);
    expect(isCrossSiteWrite({ origin: 'http://localhost:3000', host: 'localhost:3000' })).toBe(false);
    expect(isCrossSiteWrite({ origin: 'https://a.manus.space', host: '10.0.0.5:3000', 'x-forwarded-host': 'a.manus.space' })).toBe(false);
    expect(isCrossSiteWrite({ origin: 'not a url', host: 'localhost' })).toBe(true);
  });
  test('non-browser clients without Origin are allowed (the owner cookie still gates access)', () => {
    expect(isCrossSiteWrite({ host: 'localhost' })).toBe(false);
  });
});

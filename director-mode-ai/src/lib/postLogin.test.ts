import { describe, expect, it } from 'vitest';
import { safeNext } from './postLogin';
import { friendlyAuthError } from './authErrors';

describe('safeNext', () => {
  it('keeps relative paths, including a query string', () => {
    expect(safeNext('/welcome')).toBe('/welcome');
    expect(safeNext('/join/abc?x=1')).toBe('/join/abc?x=1');
  });

  it('refuses anything that could leave the site', () => {
    expect(safeNext('https://evil.example')).toBeNull();
    expect(safeNext('//evil.example')).toBeNull();
    expect(safeNext('/\\evil.example')).toBeNull();
    expect(safeNext('welcome')).toBeNull();
    expect(safeNext('')).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe('friendlyAuthError', () => {
  it('rewrites the rate-limit error', () => {
    expect(friendlyAuthError('email rate limit exceeded', 'x')).toMatch(/wait a few minutes/);
  });

  it('keeps the wait time Supabase gives', () => {
    expect(
      friendlyAuthError('For security purposes, you can only request this after 42 seconds.', 'x'),
    ).toBe('Please wait 42 seconds before requesting another link.');
  });

  it('falls back for anything it does not recognise', () => {
    expect(friendlyAuthError('something odd', 'fallback')).toBe('fallback');
    expect(friendlyAuthError(undefined, 'fallback')).toBe('fallback');
  });
});

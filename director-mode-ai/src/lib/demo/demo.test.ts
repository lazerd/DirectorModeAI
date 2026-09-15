import { describe, expect, it } from 'vitest';
import { demoLanding, parseDemoRole, sanitizeDemoNext, withArticle } from './nextPath';
import { isExampleAddress, suppressionReason } from './emailGuard';
import { siteBuilderFrom } from './siteBuilder';

describe('siteBuilderFrom', () => {
  it('names a recognised builder from any of the club links', () => {
    expect(siteBuilderFrom([null, 'https://www.club.com', 'https://rtc.wildapricot.org/Join-us'])).toBe('Wild Apricot');
    expect(siteBuilderFrom(['https://club.squarespace.com'])).toBe('Squarespace');
  });
  it('is null for an own domain or junk', () => {
    expect(siteBuilderFrom(['https://www.club.com', 'not a url', undefined])).toBeNull();
    expect(siteBuilderFrom(['https://wildapricot.org.evil.io'])).toBeNull();
  });
});

describe('sanitizeDemoNext', () => {
  it('keeps same-site paths with query and hash', () => {
    expect(sanitizeDemoNext('/member')).toBe('/member');
    expect(sanitizeDemoNext('/member/games?tab=post#form')).toBe('/member/games?tab=post#form');
    expect(sanitizeDemoNext('/event/WLDCRD?me=abc')).toBe('/event/WLDCRD?me=abc');
  });

  it('refuses anything that could leave the site', () => {
    for (const bad of [
      '//evil.com',
      '///evil.com',
      '/\\evil.com',
      '\\\\evil.com',
      'https://evil.com',
      'http:/evil.com',
      'javascript:alert(1)',
      'evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/ /evil.com',
      '',
      null,
      undefined,
    ]) {
      expect(sanitizeDemoNext(bad as string)).toBeNull();
    }
  });

  it('normalises dot segments without escaping the origin', () => {
    expect(sanitizeDemoNext('/a/../member')).toBe('/member');
    expect(sanitizeDemoNext('/../../member')).toBe('/member');
  });

  it('refuses absurdly long input', () => {
    expect(sanitizeDemoNext(`/${'a'.repeat(1200)}`)).toBeNull();
  });

  it('falls back to the role home', () => {
    expect(demoLanding('member', '//evil.com')).toBe('/member');
    expect(demoLanding('director', null)).toBe('/run/tools');
    expect(demoLanding('director', '/captain')).toBe('/captain');
  });

  it('puts the right article on the staff label', () => {
    expect(withArticle('board member')).toBe('a board member');
    expect(withArticle('owner')).toBe('an owner');
    expect(withArticle('')).toBe('a tennis director');
  });

  it('parses only the two roles', () => {
    expect(parseDemoRole('member')).toBe('member');
    expect(parseDemoRole('director')).toBe('director');
    expect(parseDemoRole('owner')).toBeNull();
    expect(parseDemoRole(null)).toBeNull();
  });
});

describe('suppressionReason', () => {
  const none = new Set<string>();
  const base = { clubIsDemo: false, actorIsDemo: false, demoEmails: none };

  it('sends an ordinary email', () => {
    expect(suppressionReason({ ...base, recipients: ['coach@sleepyhollow.org'] })).toBeNull();
  });

  it('holds any example.com recipient', () => {
    expect(suppressionReason({ ...base, recipients: ['walter.brandt@example.com'] })).toBe('example_recipient');
    expect(suppressionReason({ ...base, recipients: ['Someone@Mail.EXAMPLE.com '] })).toBe('example_recipient');
    expect(isExampleAddress('x@example.org')).toBe(true);
    expect(isExampleAddress('x@notexample.com')).toBe(false);
    expect(isExampleAddress('x@example.com.evil.io')).toBe(false);
  });

  it('holds demo logins and demo club addresses, case-insensitively', () => {
    const demoEmails = new Set(['rossmoor-member@clubmode.ai', 'mail@club.test']);
    expect(suppressionReason({ ...base, demoEmails, recipients: ['ROSSMOOR-member@clubmode.ai'] })).toBe('demo_recipient');
    expect(suppressionReason({ ...base, demoEmails, recipients: ['mail@club.test'] })).toBe('demo_recipient');
  });

  it('holds everything attributed to a demo club, even to a real person', () => {
    expect(suppressionReason({ ...base, clubIsDemo: true, recipients: ['owner@gmail.com'] })).toBe('demo_club');
  });

  it('holds everything a demo account sends or is billed for', () => {
    expect(suppressionReason({ ...base, actorIsDemo: true, recipients: ['real@gmail.com'] })).toBe('demo_actor');
  });

  it('ignores blank recipients', () => {
    expect(suppressionReason({ ...base, recipients: [null, '', undefined] })).toBeNull();
  });
});

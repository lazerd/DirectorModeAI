import { describe, it, expect, afterEach } from 'vitest';
import { isPlatformOwnerEmail, platformOwnerEmails } from './platformOwner';

const original = process.env.PLATFORM_OWNER_EMAILS;
afterEach(() => {
  if (original === undefined) delete process.env.PLATFORM_OWNER_EMAILS;
  else process.env.PLATFORM_OWNER_EMAILS = original;
});

describe('platformOwnerEmails', () => {
  it('falls back to the founding address when unset', () => {
    delete process.env.PLATFORM_OWNER_EMAILS;
    expect(platformOwnerEmails()).toEqual(['darrinjco@gmail.com']);
  });

  it('falls back rather than locking everyone out on an empty value', () => {
    // A blank or comma-only env var is a misconfiguration, not an instruction
    // to disable the owner — that way a bad deploy cannot lock us out.
    for (const v of ['', '   ', ',,']) {
      process.env.PLATFORM_OWNER_EMAILS = v;
      expect(platformOwnerEmails()).toEqual(['darrinjco@gmail.com']);
    }
  });

  it('reads a comma list, trimming and lowercasing', () => {
    process.env.PLATFORM_OWNER_EMAILS = ' A@b.com , C@D.com ';
    expect(platformOwnerEmails()).toEqual(['a@b.com', 'c@d.com']);
  });
});

describe('isPlatformOwnerEmail', () => {
  it('matches regardless of case or stray whitespace', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'owner@club.com';
    expect(isPlatformOwnerEmail(' Owner@Club.com ')).toBe(true);
  });

  it('is false for anyone else, and for no email at all', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'owner@club.com';
    expect(isPlatformOwnerEmail('megan@club.com')).toBe(false);
    expect(isPlatformOwnerEmail(null)).toBe(false);
    expect(isPlatformOwnerEmail(undefined)).toBe(false);
    expect(isPlatformOwnerEmail('')).toBe(false);
  });

  it('does not match a lookalike that merely contains an owner address', () => {
    process.env.PLATFORM_OWNER_EMAILS = 'owner@club.com';
    expect(isPlatformOwnerEmail('owner@club.com.evil.net')).toBe(false);
    expect(isPlatformOwnerEmail('xowner@club.com')).toBe(false);
  });
});

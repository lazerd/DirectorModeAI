import { describe, expect, it } from 'vitest';
import { parseFrom, stripQuoted } from './inbound';

describe('parseFrom', () => {
  it('reads a display name and lowercases the address', () => {
    expect(parseFrom('"Hal Kushins" <HKushins@aol.com>')).toEqual({ email: 'hkushins@aol.com', name: 'Hal Kushins' });
  });
  it('reads a bare address', () => {
    expect(parseFrom('hkushins@aol.com')).toEqual({ email: 'hkushins@aol.com', name: null });
  });
  it('gives up on nothing', () => {
    expect(parseFrom('')).toBeNull();
  });
});

describe('stripQuoted', () => {
  it('cuts AOL quoting on the same line as the signature (Hal, 9/22/26)', () => {
    const t =
      'Thanks but already using software program. Hal Kushins President On Tuesday, September 22, 2026 at 04:17:46 PM PDT, ClubMode <hello@clubmode.ai> wrote: Hi Hal, Congratulations';
    expect(stripQuoted(t)).toBe('Thanks but already using software program. Hal Kushins President');
  });
  it('cuts Gmail quoting', () => {
    expect(stripQuoted('Sounds good!\n\nOn Tue, Sep 22, 2026 at 4:17 PM ClubMode <hello@clubmode.ai>\nwrote:\n> Hi')).toBe(
      'Sounds good!',
    );
  });
  it('cuts Outlook quoting', () => {
    expect(stripQuoted('Call me.\n\n-----Original Message-----\nFrom: ClubMode')).toBe('Call me.');
    expect(stripQuoted('Call me.\n\nFrom: ClubMode <hello@clubmode.ai>\nSent: Tuesday\nTo: x')).toBe('Call me.');
  });
  it('leaves an unquoted email alone', () => {
    expect(stripQuoted('Yes, send the demo.')).toBe('Yes, send the demo.');
  });
});

import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhone } from './phone';

describe('normalizePhone', () => {
  it('reads the formats a captain actually types', () => {
    for (const typed of [
      '925-555-0148',
      '(925) 555-0148',
      '925.555.0148',
      '925 555 0148',
      '9255550148',
      ' 925-555-0148 ',
    ]) {
      expect(normalizePhone(typed)).toBe('+19255550148');
    }
  });

  it('accepts a leading 1', () => {
    expect(normalizePhone('1 925 555 0148')).toBe('+19255550148');
    expect(normalizePhone('19255550148')).toBe('+19255550148');
  });

  it('passes an international number through untouched', () => {
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
  });

  it('returns null for nothing', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('refuses anything it cannot confidently read', () => {
    // Storing these would look fine on the roster and fail hours later, inside
    // a batch, when someone needed telling their court had changed.
    expect(normalizePhone('555-0148')).toBeNull(); // 7 digits, no area code
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('not a number')).toBeNull();
    expect(normalizePhone('+')).toBeNull();
    expect(normalizePhone('+1')).toBeNull();
    expect(normalizePhone('92555501489999')).toBeNull(); // too long for US
  });

  it('does not mistake an extension for part of the number', () => {
    // "925-555-0148 x22" is 12 digits and must not silently become a number.
    expect(normalizePhone('925-555-0148 x22')).toBeNull();
  });
});

describe('formatPhone', () => {
  it('reads a stored number back the way a person writes it', () => {
    expect(formatPhone('+19255550148')).toBe('(925) 555-0148');
  });

  it('leaves an international number alone', () => {
    expect(formatPhone('+447700900123')).toBe('+447700900123');
  });

  it('is empty for nothing', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone(undefined)).toBe('');
  });
});

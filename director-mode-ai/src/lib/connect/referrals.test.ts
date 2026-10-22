import { describe, expect, it } from 'vitest';
import { makeReferralCode, normalizeRefCode, REFERRAL_CODE_LENGTH, referralPath, shouldRecordReferral, topReferrers } from './referrals';

describe('referral codes', () => {
  it('makes well-formed codes that round-trip through normalize', () => {
    for (let i = 0; i < 50; i++) {
      const c = makeReferralCode();
      expect(c).toHaveLength(REFERRAL_CODE_LENGTH);
      expect(normalizeRefCode(c)).toBe(c);
      expect(normalizeRefCode(c.toLowerCase())).toBe(c);
    }
  });
  it('rejects junk', () => {
    expect(normalizeRefCode('')).toBeNull();
    expect(normalizeRefCode('ABC')).toBeNull();
    expect(normalizeRefCode('ABCDEFG0')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeRefCode("AB'CDEFG")).toBeNull();
    expect(normalizeRefCode(42)).toBeNull();
  });
  it('builds the join link', () => {
    expect(referralPath('ABCDEFGH')).toBe('/connect/join?ref=ABCDEFGH');
  });
});

describe('shouldRecordReferral', () => {
  it('records only a brand-new profile referred by someone else', () => {
    expect(shouldRecordReferral({ isNewProfile: true, referrerId: 'a', referredId: 'b' })).toBe(true);
    expect(shouldRecordReferral({ isNewProfile: false, referrerId: 'a', referredId: 'b' })).toBe(false);
    expect(shouldRecordReferral({ isNewProfile: true, referrerId: 'b', referredId: 'b' })).toBe(false);
    expect(shouldRecordReferral({ isNewProfile: true, referrerId: null, referredId: 'b' })).toBe(false);
    expect(shouldRecordReferral({ isNewProfile: true, referrerId: 'a', referredId: 'b', referrerDeleted: true })).toBe(false);
  });
});

describe('topReferrers', () => {
  it('counts and ranks', () => {
    const rows = ['a', 'b', 'a', 'c', 'a', 'b'].map((referrer_candidate_id) => ({ referrer_candidate_id }));
    expect(topReferrers(rows, 2)).toEqual([{ candidate_id: 'a', count: 3 }, { candidate_id: 'b', count: 2 }]);
  });
});

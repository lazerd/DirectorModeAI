import { describe, expect, it } from 'vitest';
import { checkQuota, cleanEmail, emailableMembers, isOptedOut, monthStartUtc, planGroupFromRsvps, signUnsub, verifyUnsub, type GroupMember, type OptOut } from './groups';

describe('monthly quota', () => {
  it('month starts on the 1st, UTC', () => {
    expect(monthStartUtc(new Date('2026-11-21T15:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(monthStartUtc(new Date('2026-12-01T00:00:00Z')).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(monthStartUtc(new Date('2026-11-30T23:59:59Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
  it('allows up to the limit exactly, refuses past it, all-or-nothing', () => {
    expect(checkQuota(990, 10, { enforce: true })).toMatchObject({ ok: true, remaining: 10, limit: 1000 });
    expect(checkQuota(990, 11, { enforce: true })).toMatchObject({ ok: false, remaining: 10 });
    expect(checkQuota(1200, 1, { enforce: true })).toMatchObject({ ok: false, remaining: 0 });
  });
  it('counts but never blocks while the paywall is off', () => {
    expect(checkQuota(5000, 50, { enforce: false })).toMatchObject({ ok: true, used: 5000, remaining: 0, enforced: false });
  });
  it('custom limits and junk input', () => {
    expect(checkQuota(0, 3, { enforce: true, limit: 2 }).ok).toBe(false);
    expect(checkQuota(NaN, 0, { enforce: true }).ok).toBe(true);
  });
});

describe('who gets email', () => {
  const m = (name: string, email: string | null, opted_in = true, unsubscribed_at: string | null = null): GroupMember => ({ name, email, opted_in, unsubscribed_at });
  const owner = 'host-1', group = 'g-1';
  it('needs an email, an opt-in and no unsubscribe', () => {
    const out = emailableMembers([m('Ann', 'ann@x.com'), m('Bo', null), m('Cy', 'cy@x.com', false), m('Di', 'di@x.com', true, '2026-11-01'), m('Ed', 'not-an-email')], [], owner, group);
    expect(out.map((x) => x.name)).toEqual(['Ann']);
  });
  it('honors host-wide, group-only and everyone opt-outs', () => {
    const optouts: OptOut[] = [
      { email: 'ANN@x.com', owner_user_id: owner, group_id: null },
      { email: 'bo@x.com', owner_user_id: owner, group_id: 'other-group' },
      { email: 'cy@x.com', owner_user_id: null, group_id: null },
      { email: 'di@x.com', owner_user_id: 'someone-else', group_id: null },
      { email: 'ed@x.com', owner_user_id: owner, group_id: group },
    ];
    const out = emailableMembers([m('Ann', 'ann@x.com'), m('Bo', 'bo@x.com'), m('Cy', 'cy@x.com'), m('Di', 'di@x.com'), m('Ed', 'ed@x.com')], optouts, owner, group);
    expect(out.map((x) => x.name)).toEqual(['Bo', 'Di']);
    expect(isOptedOut('Ed@X.com', optouts, owner, group)).toBe(true);
  });
  it('one email per address', () => {
    expect(emailableMembers([m('Ann', 'ann@x.com'), m('Ann B', 'Ann@x.com ')], [], owner, group)).toHaveLength(1);
  });
});

describe('group from a game', () => {
  const rs = (id: string, name: string, extra: Partial<{ status: string; is_host: boolean; email: string | null; email_opt_in: boolean }> = {}) => ({ id, name, status: 'in', ...extra });
  it('adds new players, dedupes by lowercased name, skips the host and people who left', () => {
    const plan = planGroupFromRsvps([], [
      rs('1', 'Ann', { email: 'ann@x.com', email_opt_in: true }), rs('2', 'ann '), rs('3', 'Host', { is_host: true }), rs('4', 'Gone', { status: 'out' }),
      rs('5', 'Bo', { email: 'bo@x.com', email_opt_in: false }),
    ]);
    expect(plan.inserts).toEqual([
      { name: 'Ann', email: 'ann@x.com', opted_in: true, unsubscribed_at: null, source_rsvp_id: '1' },
      { name: 'Bo', email: null, opted_in: false, unsubscribed_at: null, source_rsvp_id: '5' },
    ]);
  });
  it('keeps existing emails and fills in missing ones from opted-in players', () => {
    const existing: GroupMember[] = [
      { id: 'a', name: 'Ann', email: 'old@x.com', opted_in: true, unsubscribed_at: null },
      { id: 'b', name: 'Bo', email: null, opted_in: false, unsubscribed_at: null },
      { id: 'c', name: 'Cy', email: 'cy@x.com', opted_in: true, unsubscribed_at: '2026-10-01' },
      { id: 'd', name: 'Di', email: 'di@x.com', opted_in: true, unsubscribed_at: null },
    ];
    const plan = planGroupFromRsvps(existing, [
      rs('1', 'ANN', { email: 'new@x.com', email_opt_in: true }), rs('2', 'bo', { email: 'bo@x.com', email_opt_in: true }),
      rs('3', 'Cy', { email: 'cy2@x.com', email_opt_in: true }), rs('4', 'Di'),
    ]);
    expect(plan.inserts).toEqual([]);
    expect(plan.updates).toEqual([{ id: 'b', email: 'bo@x.com', opted_in: true }]);
  });
});

describe('unsubscribe token', () => {
  const secret = 'test-secret';
  it('round-trips with and without a group', () => {
    const t = signUnsub({ email: 'Ann@X.com', ownerId: 'u1', groupId: 'g1' }, secret);
    expect(verifyUnsub(t, secret)).toEqual({ email: 'ann@x.com', ownerId: 'u1', groupId: 'g1' });
    expect(verifyUnsub(signUnsub({ email: 'a@x.com', ownerId: 'u1', groupId: null }, secret), secret)).toEqual({ email: 'a@x.com', ownerId: 'u1', groupId: null });
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
  it('rejects tampering, another secret and junk', () => {
    const t = signUnsub({ email: 'a@x.com', ownerId: 'u1', groupId: 'g1' }, secret);
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify(['b@x.com', 'u1', 'g1'])).toString('base64url');
    expect(verifyUnsub(`${forged}.${s}`, secret)).toBeNull();
    expect(verifyUnsub(t, 'other')).toBeNull();
    expect(verifyUnsub(`${p}.${s}x`, secret)).toBeNull();
    expect(verifyUnsub('', secret)).toBeNull();
    expect(verifyUnsub('a.b.c', secret)).toBeNull();
    expect(verifyUnsub(null, secret)).toBeNull();
  });
  it('cleanEmail', () => {
    expect(cleanEmail(' A@B.co ')).toBe('a@b.co');
    expect(cleanEmail('nope')).toBeNull();
    expect(cleanEmail(5)).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { candidateInviteEmail, draftedCount, planClubPitch, refreshInterestedCount, type PitchContact } from './outreach';

const now = new Date('2026-10-22T12:00:00Z');
const job = { club_name: 'Congressional Country Club', title: 'Director of Racquets', status: 'active', opening_id: null, deadline: null };
const gm: PitchContact = { id: 'c1', name: 'Pat Smith', role: 'gm', email: 'pat@ccclub.org', touches: 0, last_contacted_at: null, do_not_contact: false };
const board: PitchContact = { id: 'c2', name: 'Lee Board', role: 'board', email: 'lee@ccclub.org', touches: 0, last_contacted_at: null, do_not_contact: false };
const interest = (d = '2026-10-21T00:00:00Z', status = 'interested') => ({ created_at: d, status });
const base = { job, contacts: [board, gm], pitches: [], memo: null, claimUrl: 'https://x/claim/1', now };

describe('planClubPitch', () => {
  it('a job with ranked prospects but zero confirmed interests produces no club pitch', () => {
    // Prospects are not even an input: only connect_job_interests count.
    expect(planClubPitch({ ...base, interests: [] }).draft).toBeNull();
  });

  it('1 confirmed interest → no pitch; 2 → pitch', () => {
    expect(planClubPitch({ ...base, interests: [interest()] }).draft).toBeNull();
    const p = planClubPitch({ ...base, interests: [interest(), interest()] });
    expect(p.draft).not.toBeNull();
  });

  it('withdrawn / presented interests do not count toward the threshold', () => {
    expect(planClubPitch({ ...base, interests: [interest(), interest(undefined, 'withdrawn')] }).draft).toBeNull();
  });

  it('pitches the GM first and cites exactly the confirmed count', () => {
    const p = planClubPitch({ ...base, interests: [interest(), interest(), interest()] })!;
    expect(p.draft!.contact.id).toBe('c1');
    expect(p.draft!.touch).toBe(1);
    expect(p.draft!.html).toContain('3 qualified directors have told us');
    expect(draftedCount(p.draft!.html)).toBe(3);
    expect(p.draft!.html).toContain('$4,950');
  });

  it('never stacks a second draft or emails the club twice in a week', () => {
    const two = [interest(), interest()];
    expect(planClubPitch({ ...base, interests: two, pitches: [{ contact_id: 'c1', status: 'draft', sent_at: null, body_html: '' }] }).draft).toBeNull();
    expect(
      planClubPitch({ ...base, interests: two, pitches: [{ contact_id: 'c1', status: 'sent', sent_at: '2026-10-19T00:00:00Z', body_html: '' }] }).draft,
    ).toBeNull();
  });

  it('a follow-up cites only NEW confirmed interests, not a reminder', () => {
    const sentAt = '2026-10-10T00:00:00Z';
    const contacted = { ...gm, touches: 1, last_contacted_at: sentAt };
    const pitches = [{ contact_id: 'c1', status: 'sent', sent_at: sentAt, body_html: '<!-- cm-offers:intro -->' }];
    // Same two interests as last time, no memo: nothing new → no GM follow-up (board gets a first intro instead).
    const stale = planClubPitch({ ...base, contacts: [contacted], pitches, interests: [interest('2026-10-01T00:00:00Z'), interest('2026-10-02T00:00:00Z')] });
    expect(stale.draft).toBeNull();
    const fresh = planClubPitch({
      ...base, contacts: [contacted], pitches,
      interests: [interest('2026-10-01T00:00:00Z'), interest('2026-10-02T00:00:00Z'), interest('2026-10-15T00:00:00Z')],
    });
    expect(fresh.draft!.touch).toBe(2);
    expect(fresh.draft!.offers).toEqual(['new_candidates']);
    expect(fresh.draft!.html).toContain('1 more director asked to be put forward');
  });

  it('a reply stops the club sequence', () => {
    const pitches = [{ contact_id: 'c1', status: 'replied', sent_at: '2026-10-01T00:00:00Z', body_html: '' }];
    expect(planClubPitch({ ...base, contacts: [{ ...gm, touches: 1, last_contacted_at: '2026-10-01T00:00:00Z' }, board], pitches, interests: [interest(), interest(), interest()] }).draft).toBeNull();
  });
});

describe('send-time count refresh', () => {
  it('restates the current number, or refuses if the sentence was edited out', () => {
    const p = planClubPitch({ ...base, interests: [interest(), interest()] });
    const html = refreshInterestedCount(p.draft!.html, 4, 'Director of Racquets')!;
    expect(html).toContain('4 qualified directors have told us');
    expect(draftedCount(html)).toBe(4);
    expect(refreshInterestedCount('<p>edited</p>', 4, 'x')).toBeNull();
  });
});

describe('candidate invite honesty', () => {
  it('a sourced job says it was posted publicly and the club has not asked for them', () => {
    const e = candidateInviteEmail({ club_name: 'Congressional', title: 'Director of Racquets' }, 'sam', 'https://x/jobs/s-1');
    expect(e.html).toContain('posted the job publicly');
    expect(e.html).toContain("hasn't asked for you");
    expect(e.html).not.toMatch(/invited you|asked us to reach out|working with us on/i);
  });
});

describe('role scope (job board only)', () => {
  it('an assistant / teaching pro job never gets a club pitch, however many candidates confirm', () => {
    const many = [interest(), interest(), interest(), interest()];
    for (const title of ['Assistant Tennis Professional', 'Teaching Pro', 'Tennis Coach']) {
      const p = planClubPitch({ ...base, job: { ...job, title }, interests: many });
      expect(p.draft).toBeNull();
      expect(p.skipped.join(' ')).toContain('job board only');
    }
    expect(planClubPitch({ ...base, job: { ...job, title: null, role_level: 'assistant' }, interests: many }).draft).toBeNull();
    expect(planClubPitch({ ...base, job: { ...job, title: 'Head Tennis Professional', role_level: 'head_pro' }, interests: many }).draft).not.toBeNull();
  });

  it('a job-board-only invite points the candidate at the posting and never offers to present them', () => {
    const e = candidateInviteEmail({ club_name: 'Lakeside', title: 'Assistant Pro' }, 'sam', 'https://x/jobs/s-2', false, true);
    expect(e.html).toContain('apply on their posting');
    expect(e.html).not.toMatch(/present you/i);
  });

  it('candidate emails link the privacy notice', () => {
    expect(candidateInviteEmail({ club_name: 'C', title: 'Director' }, 'sam', 'https://x').html).toContain('/connect/privacy');
  });
});

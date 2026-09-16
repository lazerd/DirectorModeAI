import { describe, expect, it } from 'vitest';
import {
  looksPersonal,
  pickContact,
  regionFromNotes,
  selectFollowUps,
  selectIntros,
  type Candidate,
  type CandidateContact,
  type FollowUpSource,
} from './plan';

const TODAY = '2026-09-16';
const REP = 'darrinjco@gmail.com';

function contact(over: Partial<CandidateContact> = {}): CandidateContact {
  return {
    id: over.id ?? 'c1',
    full_name: over.full_name ?? 'Alyson Smith',
    title: over.title ?? null,
    email: over.email ?? 'asmith@theclub.org',
    is_primary: over.is_primary ?? false,
    do_not_contact: over.do_not_contact ?? false,
    is_personal_email: over.is_personal_email ?? false,
  };
}

function club(over: Partial<Candidate> = {}): Candidate {
  return {
    org_id: over.org_id ?? 'o1',
    org_name: over.org_name ?? 'A Club',
    // Not `??`: a test that says region: null means null, not the default.
    region: over.region === undefined ? 'East' : over.region,
    queued_at: over.queued_at ?? null,
    stage: over.stage ?? 'researching',
    owner_email: over.owner_email ?? null,
    city: over.city ?? null,
    state: over.state ?? null,
    website: over.website ?? null,
    contacts: over.contacts ?? [contact()],
    last_send_at: over.last_send_at ?? null,
    suppressed: over.suppressed ?? false,
    suppressed_emails: over.suppressed_emails ?? [],
    has_queue_row: over.has_queue_row ?? false,
  };
}

const opts = { cap: 10, today: TODAY, repEmail: REP };

describe('who gets proposed', () => {
  it('takes a cold club with a contact', () => {
    const { picks } = selectIntros([club()], opts);
    expect(picks).toHaveLength(1);
  });

  it('never proposes a live deal', () => {
    const { picks, skipped } = selectIntros([club({ stage: 'proposal' })], opts);
    expect(picks).toHaveLength(0);
    expect(skipped[0].reason).toBe('not_researching');
  });

  it('never proposes a suppressed club', () => {
    const { picks, skipped } = selectIntros([club({ suppressed: true })], opts);
    expect(picks).toHaveLength(0);
    expect(skipped[0].reason).toBe('suppressed');
  });

  it('never proposes a club with no email anywhere', () => {
    const { picks, skipped } = selectIntros([club({ contacts: [] })], opts);
    expect(picks).toHaveLength(0);
    expect(skipped[0].reason).toBe('no_sendable_contact');
  });

  it('never proposes a club whose only address is suppressed', () => {
    const { picks, skipped } = selectIntros(
      [club({ suppressed_emails: ['asmith@theclub.org'] })],
      opts,
    );
    expect(picks).toHaveLength(0);
    expect(skipped[0].reason).toBe('no_sendable_contact');
  });

  it('never proposes a club we have already written to', () => {
    const { picks, skipped } = selectIntros([club({ last_send_at: '2025-01-01T00:00:00Z' })], opts);
    expect(picks).toHaveLength(0);
    expect(skipped[0].reason).toBe('already_written');
  });

  it('calls a send inside 30 days "too recent" specifically', () => {
    const { skipped } = selectIntros([club({ last_send_at: '2026-09-10T00:00:00Z' })], opts);
    expect(skipped[0].reason).toBe('too_recent');
  });

  it('never proposes a club already on the queue — the re-run guard', () => {
    const { picks, skipped } = selectIntros([club({ has_queue_row: true })], opts);
    expect(picks).toHaveLength(0);
    expect(skipped[0].reason).toBe('already_queued');
  });

  it('never lets one rep write another rep\'s club', () => {
    const { picks, skipped } = selectIntros([club({ owner_email: 'kevin@example.com' })], opts);
    expect(picks).toHaveLength(0);
    expect(skipped[0].reason).toBe('another_rep');
    // Their own club is fine, in either case.
    expect(selectIntros([club({ owner_email: REP.toUpperCase() })], opts).picks).toHaveLength(1);
  });

  it('skips a do-not-contact person but still uses the club', () => {
    const { picks } = selectIntros(
      [
        club({
          contacts: [
            contact({ id: 'a', full_name: 'A Person', do_not_contact: true }),
            contact({ id: 'b', full_name: 'B Person', email: 'b@theclub.org' }),
          ],
        }),
      ],
      opts,
    );
    expect(picks[0].contact.id).toBe('b');
  });
});

describe('the order', () => {
  it('puts a rep-queued club above everything, whatever its region', () => {
    const { picks } = selectIntros(
      [
        club({ org_id: 'west', org_name: 'West Club', region: 'West' }),
        club({ org_id: 'starred', org_name: 'Zzz Club', region: 'International', queued_at: '2026-09-15T08:00:00Z' }),
      ],
      opts,
    );
    expect(picks.map((p) => p.candidate.org_id)).toEqual(['starred', 'west']);
  });

  it('orders several starred clubs by when they were starred', () => {
    const { picks } = selectIntros(
      [
        club({ org_id: 'second', queued_at: '2026-09-15T12:00:00Z' }),
        club({ org_id: 'first', queued_at: '2026-09-15T08:00:00Z' }),
      ],
      opts,
    );
    expect(picks.map((p) => p.candidate.org_id)).toEqual(['first', 'second']);
  });

  it('then runs West, Central, East, International', () => {
    const { picks } = selectIntros(
      [
        club({ org_id: 'e', region: 'East' }),
        club({ org_id: 'i', region: 'International' }),
        club({ org_id: 'w', region: 'West' }),
        club({ org_id: 'c', region: 'Central' }),
      ],
      opts,
    );
    expect(picks.map((p) => p.candidate.org_id)).toEqual(['w', 'c', 'e', 'i']);
  });

  it('sorts an unrecorded region with International, at the back', () => {
    const { picks } = selectIntros(
      [club({ org_id: 'unknown', region: null }), club({ org_id: 'east', region: 'East' })],
      opts,
    );
    expect(picks.map((p) => p.candidate.org_id)).toEqual(['east', 'unknown']);
  });

  it('breaks ties on name, so a re-run produces the same deck', () => {
    const { picks } = selectIntros(
      [
        club({ org_id: '2', org_name: 'Beta Club', region: 'West' }),
        club({ org_id: '1', org_name: 'Alpha Club', region: 'West' }),
      ],
      opts,
    );
    expect(picks.map((p) => p.candidate.org_name)).toEqual(['Alpha Club', 'Beta Club']);
  });
});

describe('the cap', () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    club({ org_id: `o${i}`, org_name: `Club ${String(i).padStart(2, '0')}` }),
  );

  it('stops at the cap', () => {
    expect(selectIntros(many, { ...opts, cap: 5 }).picks).toHaveLength(5);
  });

  it('marks the overflow rather than dropping it silently', () => {
    const { skipped } = selectIntros(many, { ...opts, cap: 5 });
    expect(skipped.filter((s) => s.reason === 'over_cap')).toHaveLength(25);
  });

  it('tops the day up instead of adding a second cap on a re-run', () => {
    const { picks } = selectIntros(many, { ...opts, cap: 5, alreadyPlannedToday: 3 });
    expect(picks).toHaveLength(2);
  });

  it('plans nothing when the day is already full', () => {
    expect(selectIntros(many, { ...opts, cap: 5, alreadyPlannedToday: 9 }).picks).toHaveLength(0);
  });
});

describe('which person at the club', () => {
  it('uses the primary when one is set, even if it is a gmail', () => {
    const chosen = pickContact([
      contact({ id: 'work', full_name: 'A', email: 'a@theclub.org' }),
      contact({ id: 'primary', full_name: 'B', email: 'b@gmail.com', is_primary: true, is_personal_email: true }),
    ]);
    expect(chosen?.id).toBe('primary');
  });

  it('otherwise prefers a club-domain address over a personal one', () => {
    const chosen = pickContact([
      contact({ id: 'gmail', full_name: 'A Person', email: 'a@gmail.com', is_personal_email: true }),
      contact({ id: 'work', full_name: 'Z Person', email: 'z@theclub.org' }),
    ]);
    expect(chosen?.id).toBe('work');
  });

  it('is stable across runs when everything else ties', () => {
    const list = [contact({ id: 'b', full_name: 'Beta' }), contact({ id: 'a', full_name: 'Alpha' })];
    expect(pickContact(list)?.id).toBe('a');
    expect(pickContact([...list].reverse())?.id).toBe('a');
  });

  it('returns nobody rather than a suppressed or do-not-contact address', () => {
    expect(pickContact([contact({ do_not_contact: true })])).toBeNull();
    expect(pickContact([contact()], ['ASMITH@THECLUB.ORG'])).toBeNull();
  });

  it('spots a freemail domain the importer did not flag', () => {
    expect(looksPersonal('someone@gmail.com', null)).toBe(true);
    expect(looksPersonal('someone@theclub.org', null)).toBe(false);
    expect(looksPersonal('someone@theclub.org', 'Personal email address from the DCA directory.')).toBe(true);
  });
});

describe('the one follow-up', () => {
  function source(over: Partial<FollowUpSource> = {}): FollowUpSource {
    return {
      queue: {
        id: over.queue?.id ?? 'q1',
        org_id: over.queue?.org_id ?? 'o1',
        contact_id: over.queue?.contact_id ?? 'c1',
        rep_email: REP,
        subject: 's',
        body: 'b',
        sent_at: over.queue?.sent_at ?? '2026-09-05T15:00:00Z',
        kind: over.queue?.kind ?? 'intro',
        status: over.queue?.status ?? 'sent',
      },
      has_follow_up: over.has_follow_up ?? false,
      suppressed: over.suppressed ?? false,
    };
  }
  const fopts = { cap: 10, today: TODAY, followUpDays: 8 };

  it('fires eight days after the intro landed', () => {
    expect(selectFollowUps([source()], fopts)).toHaveLength(1);
  });

  it('does not fire early', () => {
    expect(selectFollowUps([source({ queue: { sent_at: '2026-09-12T15:00:00Z' } as never })], fopts)).toHaveLength(0);
  });

  it('never fires a second time', () => {
    expect(selectFollowUps([source({ has_follow_up: true })], fopts)).toHaveLength(0);
  });

  it('never follows up a follow-up', () => {
    expect(selectFollowUps([source({ queue: { kind: 'followup' } as never })], fopts)).toHaveLength(0);
  });

  it('stops once the club is suppressed — a reply, a bounce, or a no', () => {
    expect(selectFollowUps([source({ suppressed: true })], fopts)).toHaveLength(0);
  });

  it('ignores an intro that never actually went out', () => {
    expect(selectFollowUps([source({ queue: { status: 'approved' } as never })], fopts)).toHaveLength(0);
  });

  it('spends the cap on the stalest first', () => {
    const due = selectFollowUps(
      [
        source({ queue: { id: 'newer', sent_at: '2026-09-07T15:00:00Z' } as never }),
        source({ queue: { id: 'older', sent_at: '2026-08-20T15:00:00Z' } as never }),
      ],
      { ...fopts, cap: 1 },
    );
    expect(due.map((d) => d.queue.id)).toEqual(['older']);
  });
});

describe('region, before the column existed', () => {
  it('reads it back out of the importer\'s note', () => {
    expect(regionFromNotes('DCA East region. From the members-only directory')).toBe('East');
    expect(regionFromNotes('DCA International region.')).toBe('International');
    expect(regionFromNotes('DCA member club (region not recorded).')).toBeNull();
    expect(regionFromNotes(null)).toBeNull();
  });
});

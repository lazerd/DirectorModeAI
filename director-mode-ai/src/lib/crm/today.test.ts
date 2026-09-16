/**
 * Today — the four questions, and the one thing that must never happen: the
 * 519 cold clubs turning it back into a list.
 */

import { describe, expect, it } from 'vitest';
import { buildToday, looksLikeAReply } from './today';
import type { OrgCard } from './types';

const TODAY = '2026-09-16';

let n = 0;
function org(over: Partial<OrgCard> = {}): OrgCard {
  n += 1;
  return {
    id: `id-${n}`,
    name: `Club ${n}`,
    slug: `club-${n}`,
    club_id: null,
    website: null,
    city: null,
    state: null,
    type: 'club',
    member_count: null,
    stage: 'contacted',
    owner_email: 'darrinjco@gmail.com',
    mrr_target_cents: 7500,
    source: null,
    region: null,
    queued_at: null,
    next_step: null,
    next_step_at: null,
    demo_url: null,
    notes: null,
    won_at: null,
    lost_at: null,
    lost_reason: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    last_activity_at: null,
    last_activity_kind: null,
    last_activity_body: null,
    contact_count: 1,
    ...over,
  };
}

/** Noon Pacific on a given day, which is what an activity row looks like. */
const at = (iso: string) => `${iso}T19:00:00.000Z`;

describe('looksLikeAReply', () => {
  it('reads the way a rep writes it', () => {
    expect(looksLikeAReply('Mary replied — wants to see it on a phone')).toBe(true);
    expect(looksLikeAReply('Got back to me, asking about price')).toBe(true);
    expect(looksLikeAReply('She wrote back from the board meeting')).toBe(true);
  });

  it('is not fooled by the opposite sentence, which the app writes itself', () => {
    expect(looksLikeAReply('demo sent 6 days ago, no reply')).toBe(false);
    expect(looksLikeAReply('Sent the demo. No response yet.')).toBe(false);
  });

  it('is false for nothing', () => {
    expect(looksLikeAReply(null)).toBe(false);
    expect(looksLikeAReply('')).toBe(false);
    expect(looksLikeAReply('Left a voicemail')).toBe(false);
  });
});

describe('buildToday', () => {
  it('says nothing when there is nothing', () => {
    const t = buildToday([org()], TODAY, null);
    expect(t.items).toEqual([]);
  });

  it('names an overdue next step with how late it is', () => {
    const t = buildToday(
      [org({ name: 'Rossmoor Tennis Club', next_step: 'Send the deck', next_step_at: '2026-09-13' })],
      TODAY,
      null,
    );
    expect(t.overdueCount).toBe(1);
    expect(t.items[0].text).toBe('Rossmoor Tennis Club: "Send the deck" was due 3 days ago');
    expect(t.items[0].tone).toBe('late');
    expect(t.items[0].actionLabel).toBe('Open it');
  });

  it('gets the singular right at one day', () => {
    const t = buildToday([org({ name: 'A', next_step: 'x', next_step_at: '2026-09-15' })], TODAY, null);
    expect(t.items[0].text).toContain('was due 1 day ago');
  });

  it('lists the first three overdue and rolls the rest up', () => {
    const late = ['A', 'B', 'C', 'D', 'E'].map((name, i) =>
      org({ name, next_step: 'chase', next_step_at: `2026-09-1${i}` }),
    );
    const t = buildToday(late, TODAY, null);
    expect(t.overdueCount).toBe(5);
    expect(t.items.filter((i) => i.tone === 'late')).toHaveLength(4);
    expect(t.items[3].text).toBe('2 more next steps are overdue');
    expect(t.items[3].orgId).toBeNull();
  });

  it('treats today as due, not overdue — you still have today', () => {
    const t = buildToday([org({ name: 'Lafayette', next_step: 'Call Hunter', next_step_at: TODAY })], TODAY, null);
    expect(t.overdueCount).toBe(0);
    expect(t.dueTodayCount).toBe(1);
    expect(t.items[0].text).toBe('Lafayette: Call Hunter — today');
    expect(t.items[0].tone).toBe('today');
  });

  it('chases a demo that has been silent for five days', () => {
    const t = buildToday(
      [org({ name: 'Orinda', stage: 'demo_done', last_activity_at: at('2026-09-11'), next_step: 'wait' })],
      TODAY,
      null,
    );
    expect(t.silentDemoCount).toBe(1);
    expect(t.items[0].text).toBe('Orinda: demo sent 5 days ago, still no reply');
  });

  it('leaves a demo alone before five days', () => {
    const t = buildToday(
      [org({ stage: 'demo_done', last_activity_at: at('2026-09-13'), next_step: 'wait' })],
      TODAY,
      null,
    );
    expect(t.silentDemoCount).toBe(0);
    expect(t.items).toEqual([]);
  });

  it('never names the same club twice', () => {
    // Overdue AND a silent demo. One line, not two.
    const t = buildToday(
      [
        org({
          name: 'Both',
          stage: 'demo_done',
          next_step: 'chase',
          next_step_at: '2026-09-10',
          last_activity_at: at('2026-09-05'),
        }),
      ],
      TODAY,
      null,
    );
    expect(t.items.filter((i) => i.text.startsWith('Both'))).toHaveLength(1);
  });

  it('surfaces a reply nobody acted on', () => {
    const t = buildToday(
      [
        org({
          name: 'Moraga',
          last_activity_at: at('2026-09-15'),
          last_activity_kind: 'email',
          last_activity_body: 'Kim replied — wants a price',
        }),
      ],
      TODAY,
      null,
    );
    expect(t.unansweredReplyCount).toBe(1);
    expect(t.items[0].text).toBe('Moraga replied yesterday and there is no next step');
    expect(t.items[0].actionLabel).toBe('Answer them');
  });

  it('says nothing about a reply that already has a next step', () => {
    const t = buildToday(
      [
        org({
          next_step: 'Send pricing Thursday',
          next_step_at: '2026-09-18',
          last_activity_body: 'Kim replied — wants a price',
          last_activity_at: at('2026-09-15'),
        }),
      ],
      TODAY,
      null,
    );
    expect(t.unansweredReplyCount).toBe(0);
    expect(t.items).toEqual([]);
  });

  it('ignores won and lost deals entirely', () => {
    const t = buildToday(
      [
        org({ stage: 'won', next_step: 'x', next_step_at: '2026-01-01' }),
        org({ stage: 'lost', next_step: 'y', next_step_at: '2026-01-01' }),
      ],
      TODAY,
      null,
    );
    expect(t.items).toEqual([]);
  });

  it('hides the deck line when there is no deck, rather than claiming an empty one', () => {
    expect(buildToday([], TODAY, null).items).toEqual([]);
  });

  it('shows the deck line, including when the deck is genuinely empty', () => {
    expect(buildToday([], TODAY, 0).items[0].text).toBe("Today's deck is empty — nothing queued to send");
    const t = buildToday([], TODAY, 12);
    expect(t.items[0].text).toBe("12 emails are waiting in today's deck");
    expect(t.items[0].href).toBe('/crm/deck');
  });

  it('falls back to the queue flag when the deck does not exist yet', () => {
    const t = buildToday([], TODAY, null, 40);
    expect(t.items[0].text).toBe('40 clubs are queued for outreach');
    expect(t.items[0].href).toBe('#cold');
  });

  it('does not turn 519 cold clubs into 519 lines', () => {
    // The caller passes live deals only. Even if a cold club slipped in, a
    // club with no next step and nothing logged is not a Today item — the
    // old nudge list said "X has no next step" for every single one.
    const cold = Array.from({ length: 300 }, () => org({ stage: 'researching', contact_count: 0 }));
    expect(buildToday(cold, TODAY, null).items).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  domainOf,
  emailOnPage,
  focusStates,
  isBackyard,
  isGenericMailbox,
  normalizeClubName,
  parseCandidates,
  regionForState,
  rejectReason,
  research,
  TARGET_STATES,
  type Candidate,
  type Known,
} from './discover';

const empty = (): Known => ({
  names: new Set(),
  namesNoState: new Set(),
  domains: new Set(),
  emails: new Set(),
  suppressedEmails: new Set(),
});

const cand = (over: Partial<Candidate> = {}): Candidate => ({
  club: 'Riverside Tennis Club',
  city: 'Boise',
  state: 'ID',
  website: 'https://www.riversidetennis.org',
  contact_name: 'Pat Lee',
  contact_title: 'Director of Tennis',
  email: 'pat@riversidetennis.org',
  source_url: 'https://www.riversidetennis.org/staff',
  why: 'Runs weekly round robins.',
  small_club: false,
  ...over,
});

describe('geography', () => {
  it('maps states onto the three send windows', () => {
    expect(regionForState('CO')).toBe('West');
    expect(regionForState('tx')).toBe('Central');
    expect(regionForState('FL')).toBe('East');
    expect(regionForState('HI')).toBeNull();
    expect(regionForState(null)).toBeNull();
  });
  it('rotates two different states a day across the whole list', () => {
    const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n));
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const s = focusStates(day(i));
      expect(s).toHaveLength(2);
      expect(s[0]).not.toBe(s[1]);
      s.forEach((x) => seen.add(x));
    }
    expect(seen.size).toBeGreaterThan(40);
    expect(focusStates(day(3))).not.toEqual(focusStates(day(4)));
    expect(TARGET_STATES).not.toContain('AK');
  });
});

describe('filters', () => {
  it('keeps us out of our own backyard', () => {
    expect(isBackyard({ club: 'Moraga Country Club', city: 'Moraga', state: 'CA' })).toBe(true);
    expect(isBackyard({ club: 'Anything', city: 'Walnut Creek', state: 'CA' })).toBe(true);
    expect(isBackyard({ club: 'Rossmoor Tennis Club', city: 'Laguna Woods', state: 'CA' })).toBe(true);
    expect(isBackyard({ club: 'Sleepy Hollow Swim & Tennis', city: 'X', state: 'NY' })).toBe(true);
    expect(isBackyard({ club: 'Lafayette Tennis Club', city: 'Lafayette', state: 'LA' })).toBe(false);
  });
  it('spots shared mailboxes', () => {
    expect(isGenericMailbox('info@club.org')).toBe(true);
    expect(isGenericMailbox('Office@club.org')).toBe(true);
    expect(isGenericMailbox('pat.lee@club.org')).toBe(false);
  });
  it('normalizes club names so C.C. and Country Club collide', () => {
    expect(normalizeClubName('The Aberdeen C.C.')).toBe(normalizeClubName('Aberdeen Country Club'));
    expect(normalizeClubName('Riverside Tennis & Swim Club, Inc.')).toBe('riverside tennis swim');
  });
  it('reads a domain from a messy website', () => {
    expect(domainOf('www.Foo-Tennis.org/about')).toBe('foo-tennis.org');
    expect(domainOf('')).toBeNull();
  });
});

describe('rejectReason', () => {
  it('passes a good candidate', () => {
    expect(rejectReason(cand(), empty())).toBeNull();
  });
  it('drops what we already have', () => {
    const k = empty();
    k.names.add(`${normalizeClubName('Riverside Tennis Club')}|ID`);
    expect(rejectReason(cand(), k)).toMatch(/already in the CRM/);
    const k2 = empty();
    k2.namesNoState.add(normalizeClubName('The Riverside Tennis Club'));
    expect(rejectReason(cand(), k2)).toMatch(/already/);
    const k3 = empty();
    k3.domains.add('riversidetennis.org');
    expect(rejectReason(cand(), k3)).toMatch(/website already/);
    const k4 = empty();
    k4.suppressedEmails.add('pat@riversidetennis.org');
    expect(rejectReason(cand({ email: 'PAT@riversidetennis.org' }), k4)).toMatch(/suppressed/);
  });
  it('drops shared mailboxes unless the club is small', () => {
    expect(rejectReason(cand({ email: 'info@riversidetennis.org' }), empty())).toMatch(/shared mailbox/);
    expect(rejectReason(cand({ email: 'info@riversidetennis.org', small_club: true }), empty())).toBeNull();
  });
  it('drops the backyard, the off-target states and nameless rows', () => {
    expect(rejectReason(cand({ city: 'Danville', state: 'CA' }), empty())).toMatch(/backyard/);
    expect(rejectReason(cand({ state: 'HI' }), empty())).toMatch(/outside/);
    expect(rejectReason(cand({ contact_name: '' }), empty())).toMatch(/named person/);
    expect(rejectReason(cand({ email: 'not an email' }), empty())).toMatch(/email/);
  });
});

describe('emailOnPage', () => {
  it('finds a plain address, case-insensitively', () => {
    expect(emailOnPage('<a href="mailto:Pat@Club.org">Pat</a>', 'pat@club.org')).toBe(true);
  });
  it('sees through entities and [at] hiding', () => {
    expect(emailOnPage('pat&#64;club&#46;org', 'pat@club.org')).toBe(true);
    expect(emailOnPage('pat [at] club [dot] org', 'pat@club.org')).toBe(true);
  });
  it('decodes Cloudflare email protection', () => {
    const email = 'pat@club.org';
    const key = 0x42;
    const hex = key.toString(16) + [...email].map((ch) => (ch.charCodeAt(0) ^ key).toString(16).padStart(2, '0')).join('');
    expect(emailOnPage(`<span data-cfemail="${hex}">[email protected]</span>`, email)).toBe(true);
  });
  it('rejects a guessed address', () => {
    expect(emailOnPage('Contact Pat Lee at the front desk.', 'pat.lee@club.org')).toBe(false);
  });
});

describe('research (fake client)', () => {
  const report = {
    type: 'tool_use',
    name: 'report_clubs',
    input: { clubs: [{ ...cand(), city: 'Boise' }] },
  };
  it('continues through pause_turn and reads report_clubs', async () => {
    const calls: unknown[] = [];
    const replies = [
      { stop_reason: 'pause_turn', content: [{ type: 'text' }], usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 3 } } },
      { stop_reason: 'tool_use', content: [report], usage: { input_tokens: 200, output_tokens: 20, server_tool_use: { web_search_requests: 2, web_fetch_requests: 4 } } },
    ];
    const client = { messages: { create: async (a: Record<string, unknown>) => (calls.push(a), replies.shift()) } };
    const r = await research(client, 4, ['ID', 'TX'], []);
    expect(calls).toHaveLength(2);
    expect(r.candidates).toHaveLength(1);
    expect(r.usage).toEqual({ input: 300, output: 30, searches: 5, fetches: 4 });
  });
  it('returns nothing, with a note, on a refusal or an outage', async () => {
    const refuse = { messages: { create: async () => ({ stop_reason: 'refusal', content: [] }) } };
    expect((await research(refuse, 4, ['ID'], [])).note).toMatch(/declined/);
    const down = { messages: { create: async () => { throw new Error('529 overloaded'); } } };
    const r = await research(down, 4, ['ID'], []);
    expect(r.candidates).toEqual([]);
    expect(r.note).toMatch(/overloaded/);
  });
  it('parses defensively', () => {
    expect(parseCandidates({ clubs: [{ club: 'X' }, cand()] })).toHaveLength(1);
    expect(parseCandidates(null)).toEqual([]);
  });
});

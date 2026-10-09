import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What these guard:
 *   1. NOTHING IS WRITTEN OR SENT WITHOUT confirm:true — every write/send tool
 *      previews through the real framework binding first.
 *   2. PREVIEW AND RUN AGREE — the run does exactly what the preview listed
 *      (who is added, who is emailed), and refuses when it moved.
 *   3. A PERSON IS A VAULT ROW — households share inboxes and stay separate;
 *      a duplicate with history is never removed.
 *   4. SCOPING — another club's people, games and lessons are unreachable.
 *   5. CourtConnect's own rules hold: only the poster seats or cancels.
 *
 * Only the last hops are replaced: the shared mailer, the CourtConnect mailer
 * (notify.ts) and the background runner. CourtConnect's actions (hostAddPlayer,
 * cancelGame) run for real against an in-memory database whose pf_* functions
 * mirror the SQL's rules.
 */

const mail: { userId: string | null; payload: any }[] = [];
vi.mock('@/lib/email', () => {
  class CreditLimitError extends Error {}
  return {
    sendBilledEmail: vi.fn(async (userId: string | null, payload: any) => {
      mail.push({ userId, payload });
      return { sent: true };
    }),
    sendBilledEmails: vi.fn(async () => []),
    resolveCoachUserId: vi.fn(async () => 'coach-user'),
    CreditLimitError,
  };
});

const notified: { fn: string; args: unknown[] }[] = [];
vi.mock('@/lib/partnerFinder/notify', () => ({
  inviteMembers: vi.fn(async (...args: unknown[]) => (notified.push({ fn: 'inviteMembers', args }), 4)),
  afterCancel: vi.fn(async (...args: unknown[]) => void notified.push({ fn: 'afterCancel', args })),
  afterJoin: vi.fn(async (...args: unknown[]) => void notified.push({ fn: 'afterJoin', args })),
  afterLeave: vi.fn(async () => undefined),
  inviteGuests: vi.fn(async () => ({ recipients: [], subject: '', sent: 0, skipped: [] })),
  messageSignups: vi.fn(async () => ({ recipients: [], subject: '', sent: 0, noEmail: [] })),
}));
vi.mock('@/lib/partnerFinder/background', () => ({
  background: (_label: string, work: () => Promise<unknown>) => void work(),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), createServiceClient: vi.fn() }));

import { bindPack } from '../framework';
import { peoplePack, nameMatches } from './people';
import { zonedWallTimeToIso } from '@/lib/captain/clubTime';

const TZ = 'America/Los_Angeles';
type Row = Record<string, any>;

const ymd = (offset: number) => {
  const t = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const d = new Date(`${t}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const at = (offset: number, hm: string) => zonedWallTimeToIso(`${ymd(offset)}T${hm}`, TZ)!;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  const log: { op: string; table: string; payload?: unknown }[] = [];
  let seq = 0;

  function from(table: string) {
    const rows = (tables[table] ??= []);
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any;
    const filters: ((r: Row) => boolean)[] = [];
    let limit: number | undefined;
    const exec = async () => {
      if (op === 'insert') {
        const items = (Array.isArray(payload) ? payload : [payload]).map((p: Row) => ({ id: `new-${++seq}`, ...p }));
        rows.push(...items);
        log.push({ op, table, payload });
        return { data: items, error: null, count: items.length };
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (op === 'update') {
        for (const r of hit) Object.assign(r, payload);
        log.push({ op, table, payload });
      }
      if (op === 'delete') {
        for (const r of hit) rows.splice(rows.indexOf(r), 1);
        log.push({ op, table });
      }
      if (limit != null) hit = hit.slice(0, limit);
      return { data: hit, error: null, count: hit.length };
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) === String(v)), q),
      neq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) !== String(v)), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.map(String).includes(String(r[c]))), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), q),
      lt: (c: string, v: string) => (filters.push((r) => String(r[c]) < v), q),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      insert: (p: unknown) => ((op = 'insert'), (payload = p), q),
      update: (p: unknown) => ((op = 'update'), (payload = p), q),
      delete: () => ((op = 'delete'), q),
      upsert: () => q,
      maybeSingle: () => exec().then((r) => ({ ...r, data: r.data[0] ?? null })),
      single: () => exec().then((r) => ({ ...r, data: r.data[0] ?? null })),
      then: (ok: any, bad: any) => exec().then(ok, bad),
    };
    return q;
  }

  // ---- the pf_* functions, with the SQL's rules
  const posterPerson = (gameId: string) => {
    const g = tables.pf_games.find((x) => x.id === gameId);
    return g ? tables.cc_vault_players.find((v) => v.club_id === g.club_id && v.user_id === g.posted_by)?.id ?? null : null;
  };
  async function rpc(name: string, a: Row) {
    log.push({ op: `rpc:${name}`, table: name, payload: a });
    if (name === 'pf_member_roster') {
      const data = tables.cc_vault_players
        .filter((v) => v.club_id === a.p_club && (v.membership_status ?? 'active') !== 'inactive')
        .filter((v) => (!a.p_user || v.user_id === a.p_user) && (!a.p_person || v.id === a.p_person))
        .map((v) => {
          const pr = (tables.pf_member_prefs ?? []).find((p) => p.person_id === v.id);
          const m = (tables.cc_club_members ?? []).find((x) => x.club_id === v.club_id && x.user_id === v.user_id);
          return {
            person_id: v.id, user_id: v.user_id ?? null, email: v.email ? String(v.email).toLowerCase() : null, full_name: v.full_name,
            role: m?.role ?? 'member', ntrp: v.usta_rating ?? null, ntrp_source: v.usta_rating != null ? 'club' : null,
            notify_games: pr?.notify_games ?? true, share_phone: false, phone: v.phone ?? null, stop_token: null, dupr_singles: null, dupr_doubles: null,
          };
        });
      return { data, error: null };
    }
    if (name === 'pf_post_game') {
      const id = `g-new-${++seq}`;
      tables.pf_games.push({
        id, club_id: a.p_club, posted_by: a.p_user, starts_at: a.p_starts_at, duration_min: a.p_duration, format: a.p_format,
        spots_needed: a.p_spots, rating_min: a.p_rating_min, rating_max: a.p_rating_max, include_unrated: a.p_include_unrated,
        court: a.p_court || null, note: a.p_note || null, gender: null, status: 'open', notified_count: 0, created_at: new Date().toISOString(),
      });
      return { data: { ok: true, game_id: id }, error: null };
    }
    if (name === 'pf_host_add') {
      if (posterPerson(a.p_game) !== a.p_actor) return { data: { result: 'not_poster' }, error: null };
      const g = tables.pf_games.find((x) => x.id === a.p_game)!;
      tables.pf_game_players.push({ id: `seat-${++seq}`, game_id: a.p_game, club_id: g.club_id, person_id: a.p_person, guest_name: a.p_guest_name, status: 'in', via: 'host', joined_at: new Date().toISOString() });
      const taken = tables.pf_game_players.filter((p) => p.game_id === a.p_game && p.status === 'in').length;
      return { data: { result: 'added', now_full: taken >= g.spots_needed, is_guest: !a.p_person, name: a.p_guest_name ?? 'member' }, error: null };
    }
    if (name === 'pf_cancel_game') {
      if (posterPerson(a.p_game) !== a.p_person) return { data: { result: 'not_poster' }, error: null };
      const g = tables.pf_games.find((x) => x.id === a.p_game)!;
      g.status = 'cancelled';
      return { data: { result: 'cancelled' }, error: null };
    }
    return { data: null, error: { message: `no fake for ${name}` } };
  }

  const auth = { admin: { getUserById: async (id: string) => ({ data: { user: { email: `${id}@login.com` } } }) } };
  return { db: { from, rpc, auth }, tables, log, writes: () => log.filter((l) => l.op !== 'select') };
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DIRECTOR = 'u-dir';
const V = (n: number, full_name: string, extra: Row = {}) => ({
  id: ID(n), club_id: 'c1', full_name, email: null, phone: null, gender: null, age: null, usta_rating: null, wtn: null,
  utr_singles: null, membership_status: 'active', user_id: null, created_at: '2026-01-01T00:00:00Z', ...extra,
});

const GAME = ID(500);
const OTHER_GAME = ID(501);
const SLOT_MANUAL = ID(700);
const SLOT_OPEN = ID(701);
const SLOT_OTHER_CLUB = ID(702);
const SLOT_SHANNON = ID(703);

function seed() {
  return {
    cc_clubs: [
      { id: 'c1', name: 'Sleepy Hollow', slug: 'sh', timezone: TZ, owner_id: DIRECTOR, sports: ['tennis'], email: null },
      { id: 'c2', name: 'Elsewhere', slug: 'else', timezone: TZ, owner_id: 'u-x', sports: ['tennis'], email: null },
    ],
    cc_club_members: [
      { club_id: 'c1', user_id: DIRECTOR, role: 'owner' },
      { club_id: 'c1', user_id: 'u-shannon', role: 'coach' },
      { club_id: 'c1', user_id: 'u-simon', role: 'member' },
      { club_id: 'c1', user_id: 'u-desk', role: 'front_desk' },
    ],
    profiles: [
      { id: DIRECTOR, full_name: 'Darrin Cohen' },
      { id: 'u-shannon', full_name: 'Shannon Koffman' },
      { id: 'u-simon', full_name: 'Simon Chan' },
      { id: 'u-desk', full_name: 'Fran Desk' },
    ],
    cc_vault_players: [
      V(1, 'Darrin Cohen', { email: 'darrin@x.com', user_id: DIRECTOR, usta_rating: 4.0 }),
      V(2, 'Simon Chan', { email: 'simon@x.com', phone: '555-1111', user_id: 'u-simon', usta_rating: 4.0 }),
      V(3, 'Simon Chan', { email: 'simon.chan@work.com', created_at: '2026-09-01T00:00:00Z' }), // the empty copy
      V(4, 'Shannon Koffman', { email: 'shannon@x.com', user_id: 'u-shannon', usta_rating: 3.5 }),
      V(5, 'Lauren Disston', { email: 'lauren@x.com', usta_rating: 4.0 }),
      V(6, 'Lawrence Browne', { email: 'walden@x.com', usta_rating: 4.0 }),
      V(7, 'Mia Petrov', { email: 'petrov@x.com', age: 12 }),
      V(8, 'Dimitry Petrov', { email: 'petrov@x.com', usta_rating: 4.0 }), // same household inbox
      V(9, 'Gabe Fox', { email: 'gabe@x.com', usta_rating: 4.0 }),
      V(10, 'Ivy Low', { email: 'ivy@x.com', usta_rating: 3.0 }),
      V(11, 'Muted Max', { email: 'max@x.com', usta_rating: 4.0 }),
      V(12, 'Nomail Ned', { usta_rating: 4.0 }),
      V(99, 'Outsider Oz', { club_id: 'c2', email: 'oz@x.com', usta_rating: 4.0 }),
    ],
    pf_member_prefs: [{ club_id: 'c1', person_id: ID(11), notify_games: false, phone: null }],
    email_unsubscribes: [{ email: 'lauren@x.com', scope: 'all', unsubscribed_at: '2026-08-01T00:00:00Z' }],
    pf_games: [
      { id: GAME, club_id: 'c1', posted_by: DIRECTOR, starts_at: at(2, '09:00'), duration_min: 90, format: 'doubles', spots_needed: 3, rating_min: 4.0, rating_max: 4.0, include_unrated: false, court: null, note: null, gender: null, status: 'open', notified_count: 5, created_at: new Date(Date.now() - 3 * 864e5).toISOString() },
      { id: OTHER_GAME, club_id: 'c1', posted_by: 'u-simon', starts_at: at(3, '18:00'), duration_min: 60, format: 'singles', spots_needed: 1, rating_min: null, rating_max: null, include_unrated: true, court: null, note: null, gender: null, status: 'open', notified_count: 3, created_at: new Date(Date.now() - 2 * 864e5).toISOString() },
    ],
    pf_game_players: [
      { id: 's1', game_id: GAME, club_id: 'c1', person_id: ID(9), guest_name: null, status: 'in', via: 'email', joined_at: '1' },
      { id: 's2', game_id: GAME, club_id: 'c1', person_id: ID(6), guest_name: null, status: 'no', via: 'email', joined_at: '2' },
      { id: 's3', game_id: GAME, club_id: 'c1', person_id: ID(12), guest_name: null, status: 'in', via: 'host', joined_at: '3' },
      { id: 's4', game_id: OTHER_GAME, club_id: 'c1', person_id: ID(2), guest_name: null, status: 'no', via: 'email', joined_at: '1' },
    ],
    pf_links: [
      { game_id: GAME, person_id: ID(9), emailed_at: '2026-10-01' },
      { game_id: GAME, person_id: ID(6), emailed_at: '2026-10-01' },
      { game_id: GAME, person_id: ID(8), emailed_at: '2026-10-01' },
      { game_id: OTHER_GAME, person_id: ID(2), emailed_at: '2026-10-01' },
    ],
    pf_guest_links: [],
    pf_guest_contacts: [],
    club_program_attendance: [],
    captain_teams: [{ id: 't1', club_id: 'c1', name: '4.0 Ladies', archived: false }],
    captain_players: [{ team_id: 't1', name: 'Lauren Disston', email: 'lauren.old@x.com', contact2_email: null, active: true }],
    leagues: [],
    lesson_coaches: [
      { id: 'lc-julia', display_name: 'Julia Ruiz', email: 'julia@x.com', profile_id: 'u-julia', club_id: 'c1', timezone: TZ },
      { id: 'lc-shannon', display_name: 'Shannon Koffman', email: 'shannon@x.com', profile_id: 'u-shannon', club_id: 'c1', timezone: TZ },
      { id: 'lc-far', display_name: 'Julia Far', email: 'far@x.com', profile_id: 'u-far', club_id: 'c2', timezone: TZ },
    ],
    lesson_clients: [{ id: 'cl1', name: 'Pat Client', email: 'pat@x.com' }],
    lesson_slots: [
      { id: SLOT_MANUAL, coach_id: 'lc-julia', start_time: at(1, '16:00'), end_time: at(1, '17:00'), status: 'booked', source: 'manual', location: 'Court 3', booked_by_client_id: 'cl1', guest_name: null, guest_email: null },
      { id: SLOT_OPEN, coach_id: 'lc-julia', start_time: at(1, '18:00'), end_time: at(1, '19:00'), status: 'booked', source: 'google_open', location: null, booked_by_client_id: null, guest_name: 'Opal', guest_email: 'opal@x.com' },
      { id: SLOT_OTHER_CLUB, coach_id: 'lc-far', start_time: at(1, '16:00'), end_time: at(1, '17:00'), status: 'booked', source: 'manual', location: null, booked_by_client_id: 'cl1', guest_name: null, guest_email: null },
      { id: SLOT_SHANNON, coach_id: 'lc-shannon', start_time: at(1, '10:00'), end_time: at(1, '11:00'), status: 'open', source: 'manual', location: null, booked_by_client_id: null, guest_name: null, guest_email: null },
    ],
    cc_club_level_tiers: [],
  };
}

function setup(role = 'owner', userId = DIRECTOR) {
  const f = fakeDb(seed());
  const ctx = { userId, db: f.db as any, clubId: 'c1', clubName: 'Sleepy Hollow', clubSlug: 'sh', timeZone: TZ, role };
  return { ...f, pack: bindPack(peoplePack, ctx) };
}

const realWrites = (log: { op: string; table: string }[]) =>
  log.filter((l) => l.op !== 'select' && !(l.op === 'rpc:pf_member_roster'));

beforeEach(() => {
  mail.length = 0;
  notified.length = 0;
});

describe('nameMatches', () => {
  it('matches whole words, never substrings', () => {
    expect(nameMatches('Chan', 'Simon Chan')).toBe(true);
    expect(nameMatches('simon chan', 'Simon Chan')).toBe(true);
    expect(nameMatches('Cha', 'Simon Chan')).toBe(false);
  });
});

describe('find_person', () => {
  it('returns contact, membership and access level; several matches are all shown', async () => {
    const { pack } = setup();
    const r: any = await pack.execute('find_person', { name: 'Simon Chan' });
    expect(r.ok).toBe(true);
    expect(r.people).toHaveLength(2);
    const real = r.people.find((p: any) => p.id === ID(2));
    expect(real.email).toBe('simon@x.com');
    expect(real.phone).toBe('555-1111');
    expect(real.access).toMatch(/Member/i);
    expect(r.people.find((p: any) => p.id === ID(3)).access).toMatch(/roster only/);
  });

  it("reports a coach's access, and a household inbox without merging people", async () => {
    const { pack } = setup('coach', 'u-shannon');
    const s: any = await pack.execute('find_person', { name: 'Shannon' });
    expect(s.people[0].access).toMatch(/Coach/i);
    const m: any = await pack.execute('find_person', { name: 'Mia Petrov' });
    expect(m.people[0].shares_inbox_with).toEqual(['Dimitry Petrov']);
  });

  it('finds staff with a login but no PlayerVault row', async () => {
    const { pack } = setup();
    const r: any = await pack.execute('find_person', { name: 'Fran' });
    expect(r.login_only[0]).toMatchObject({ name: 'Fran Desk', email: 'u-desk@login.com' });
  });

  it("never sees another club's people", async () => {
    const { pack } = setup();
    const r: any = await pack.execute('find_person', { name: 'Outsider Oz' });
    expect(r.found).toBe(0);
    const byId: any = await pack.execute('find_person', { name: ID(99) });
    expect(byId.found).toBe(0);
  });
});

describe('update_person', () => {
  it('previews the rename without writing, then writes exactly that on confirm', async () => {
    const { pack, log, tables } = setup();
    const pv: any = await pack.execute('update_person', { person: 'Lawrence Browne', full_name: 'Walden Browne' });
    expect(pv.needsConfirm).toBe(true);
    expect(pv.changes).toEqual(['name: "Lawrence Browne" → "Walden Browne"']);
    expect(realWrites(log)).toHaveLength(0);
    const r: any = await pack.execute('update_person', { person: 'Lawrence Browne', full_name: 'Walden Browne', confirm: true });
    expect(r.ok).toBe(true);
    expect(r.changes).toEqual(pv.changes);
    expect(tables.cc_vault_players.find((v) => v.id === ID(6))!.full_name).toBe('Walden Browne');
    expect(realWrites(log)).toHaveLength(1);
  });

  it('asks which when the name is ambiguous, and refuses a coach', async () => {
    const { pack } = setup();
    const amb: any = await pack.execute('update_person', { person: 'Simon Chan', phone: '1' });
    expect(amb.ok).toBe(false);
    expect(amb.candidates).toHaveLength(2);
    const coach = setup('coach', 'u-shannon');
    const r: any = await coach.pack.execute('update_person', { person: 'Lawrence Browne', full_name: 'X', confirm: true });
    expect(r.ok).toBe(false);
    expect(realWrites(coach.log)).toHaveLength(0);
  });

  it("cannot reach another club's person by id", async () => {
    const { pack, log } = setup();
    const r: any = await pack.execute('update_person', { person: ID(99), full_name: 'Hacked', confirm: true });
    expect(r.ok).toBe(false);
    expect(realWrites(log)).toHaveLength(0);
  });
});

describe('remove_duplicate_person', () => {
  it('by name, lists each candidate with what it has', async () => {
    const { pack } = setup();
    const r: any = await pack.execute('remove_duplicate_person', { keep: 'Simon Chan', remove: 'Simon Chan' });
    expect(r.ok).toBe(false);
    const has = Object.fromEntries(r.candidates.map((c: any) => [c.id, c.has]));
    expect(has[ID(2)].join(' ')).toMatch(/login/);
    expect(has[ID(3)]).toEqual([]);
  });

  it('refuses to remove the record with history', async () => {
    const { pack, log } = setup();
    const r: any = await pack.execute('remove_duplicate_person', { keep: ID(3), remove: ID(2), confirm: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/history/);
    expect(realWrites(log)).toHaveLength(0);
  });

  it('removes the empty copy only on confirm', async () => {
    const { pack, log, tables } = setup();
    const pv: any = await pack.execute('remove_duplicate_person', { keep: ID(2), remove: ID(3) });
    expect(pv.needsConfirm).toBe(true);
    expect(pv.remove.id).toBe(ID(3));
    expect(realWrites(log)).toHaveLength(0);
    const r: any = await pack.execute('remove_duplicate_person', { keep: ID(2), remove: ID(3), confirm: true });
    expect(r.ok).toBe(true);
    expect(tables.cc_vault_players.some((v) => v.id === ID(3))).toBe(false);
    expect(tables.cc_vault_players.some((v) => v.id === ID(2))).toBe(true);
  });
});

describe('why_no_emails', () => {
  it('finds the unsubscribe and the different roster address', async () => {
    const { pack, log } = setup();
    const r: any = await pack.execute('why_no_emails', { name: 'Lauren' });
    expect(r.ok).toBe(true);
    const all = r.findings.join('\n');
    expect(all).toMatch(/lauren@x\.com is on the unsubscribe list/);
    expect(all).toMatch(/4\.0 Ladies.*lauren\.old@x\.com.*different from PlayerVault/);
    expect(realWrites(log)).toHaveLength(0);
  });

  it('spots muted game emails and a missing address', async () => {
    const { pack } = setup();
    expect(((await pack.execute('why_no_emails', { name: 'Muted Max' })) as any).findings.join(' ')).toMatch(/turned off CourtConnect/);
    expect(((await pack.execute('why_no_emails', { name: 'Nomail Ned' })) as any).findings.join(' ')).toMatch(/No email/);
  });
});

describe('add_members', () => {
  const people = [
    { name: 'New Person', email: 'new@x.com' },
    { name: 'Lauren Disston', email: 'lauren@x.com' }, // already there
    { name: 'Gabe Fox', email: 'gabe.other@x.com' }, // same name, different email
    { name: 'Sasha Petrov', email: 'petrov@x.com' }, // household inbox — a new person
    { name: 'New Person', email: 'new@x.com' }, // repeated in the list
    { name: 'Bad Mail', email: 'nope' },
  ];

  it('previews the dedupe and inserts exactly the previewed people on confirm', async () => {
    const { pack, log, tables } = setup();
    const pv: any = await pack.execute('add_members', { people });
    expect(pv.needsConfirm).toBe(true);
    expect(pv.will_add).toBe(2);
    expect(pv.add[1]).toMatch(/Sasha Petrov.*shares an inbox with Mia Petrov, Dimitry Petrov/);
    expect(pv.already_on_playervault).toEqual(['Lauren Disston (lauren@x.com)']);
    expect(pv.possible_duplicates_held_back[0]).toMatch(/Gabe Fox/);
    expect(pv.invalid[0]).toMatch(/Bad Mail/);
    expect(realWrites(log)).toHaveLength(0);

    const before = tables.cc_vault_players.length;
    const r: any = await pack.execute('add_members', { people, confirm: true });
    expect(r.names).toEqual(['New Person', 'Sasha Petrov']);
    expect(tables.cc_vault_players.length).toBe(before + 2);
    const added = tables.cc_vault_players.slice(-2);
    expect(added.every((a) => a.club_id === 'c1' && a.director_id === DIRECTOR)).toBe(true);
    expect(mail).toHaveLength(0);
  });

  it('adds a held-back name when the director says it is a different person', async () => {
    const { pack } = setup();
    const r: any = await pack.execute('add_members', { people: [{ name: 'Gabe Fox', email: 'gabe.other@x.com' }], add_anyway: ['Gabe Fox'], confirm: true });
    expect(r.added).toBe(1);
  });
});

describe('CourtConnect', () => {
  const POST = { date: ymd(1), time: '13:00', format: 'doubles', at_my_level: true };

  it('post_game previews who is emailed at the director level, writes and sends nothing', async () => {
    const { pack, log } = setup();
    const pv: any = await pack.execute('post_game', POST);
    expect(pv.needsConfirm).toBe(true);
    expect(pv.level).toBe('4.0');
    const names = pv.recipients.map((r: string) => r.replace(/ \(.*$/, '')).sort();
    // 4.0s with an email, not muted, not unsubscribed, not the director, not another club.
    expect(names).toEqual(['Dimitry Petrov', 'Gabe Fox', 'Lawrence Browne', 'Simon Chan']);
    expect(pv.not_emailed).toMatchObject({ muted: 1, unsubscribed: 1, no_email: 1 });
    expect(realWrites(log)).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });

  it('post_game refuses without the preview key, then posts and invites with it', async () => {
    const { pack, log, tables } = setup();
    const pv: any = await pack.execute('post_game', POST);
    const bad: any = await pack.execute('post_game', { ...POST, confirm: true });
    expect(bad.ok).toBe(false);
    expect(realWrites(log)).toHaveLength(0);
    const r: any = await pack.execute('post_game', { ...POST, confirm: true, send_key: pv.send_key });
    expect(r.ok).toBe(true);
    const g = tables.pf_games.find((x) => x.id === r.game_id)!;
    expect(g).toMatchObject({ club_id: 'c1', posted_by: DIRECTOR, format: 'doubles', spots_needed: 3, rating_min: 4.0, rating_max: 4.0 });
    expect(notified.filter((n) => n.fn === 'inviteMembers')).toHaveLength(1);
  });

  it('game_answers says who said yes, no, and never answered', async () => {
    const { pack } = setup();
    const r: any = await pack.execute('game_answers', { game: GAME });
    expect(r.yes).toEqual(['Darrin Cohen (poster)', 'Gabe Fox', 'Nomail Ned — added by host']);
    expect(r.no).toEqual(['Lawrence Browne']);
    expect(r.emailed_no_reply).toEqual(['Dimitry Petrov']);
  });

  it('add_player_to_game seats a guest only after confirm, through the poster path', async () => {
    const { pack, log, tables } = setup();
    const pv: any = await pack.execute('add_player_to_game', { game: GAME, guest_name: 'Pete Outside' });
    expect(pv.needsConfirm).toBe(true);
    expect(pv.fills_the_game).toBe(true);
    expect(realWrites(log)).toHaveLength(0);
    const r: any = await pack.execute('add_player_to_game', { game: GAME, guest_name: 'Pete Outside', confirm: true });
    expect(r.ok).toBe(true);
    expect(tables.pf_game_players.some((p) => p.guest_name === 'Pete Outside' && p.status === 'in')).toBe(true);
    expect(notified.some((n) => n.fn === 'afterJoin')).toBe(true);
  });

  it("will not seat or cancel on somebody else's game", async () => {
    const { pack, log } = setup();
    const a: any = await pack.execute('add_player_to_game', { game: OTHER_GAME, guest_name: 'X', confirm: true });
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/posted by Simon Chan/);
    const c: any = await pack.execute('cancel_game', { game: OTHER_GAME, confirm: true });
    expect(c.ok).toBe(false);
    expect(realWrites(log)).toHaveLength(0);
  });

  it('cancel_game tells only the people who said yes, and only on confirm', async () => {
    const { pack, log, tables } = setup();
    const pv: any = await pack.execute('cancel_game', { game: GAME });
    expect(pv.emails_cancellation_to).toEqual(['Gabe Fox']);
    expect(pv.not_told[0]).toMatch(/Nomail Ned/);
    expect(realWrites(log)).toHaveLength(0);
    expect(notified).toHaveLength(0);
    const r: any = await pack.execute('cancel_game', { game: GAME, confirm: true, send_key: pv.send_key });
    expect(r.ok).toBe(true);
    expect(tables.pf_games.find((g) => g.id === GAME)!.status).toBe('cancelled');
    expect(notified.map((n) => n.fn)).toEqual(['afterCancel']);
  });
});

describe('lessons', () => {
  it("lists a coach's lessons for a day, never another club's", async () => {
    const { pack } = setup();
    const r: any = await pack.execute('lessons_schedule', { coach: 'Julia', from: ymd(1) });
    expect(r.coaches).toEqual(['Julia Ruiz']);
    expect(r.lessons.map((l: any) => l.id)).toEqual([SLOT_MANUAL, SLOT_OPEN]);
    expect(r.lessons[0].client).toBe('Pat Client');
  });

  it('cancel_lesson previews who is told, then removes and sends LessonMode\'s email once', async () => {
    const { pack, log, tables } = setup();
    const pv: any = await pack.execute('cancel_lesson', { lesson_id: SLOT_MANUAL });
    expect(pv.needsConfirm).toBe(true);
    expect(pv.emails).toMatch(/Pat Client <pat@x\.com>/);
    expect(realWrites(log)).toHaveLength(0);
    expect(mail).toHaveLength(0);
    const r: any = await pack.execute('cancel_lesson', { lesson_id: SLOT_MANUAL, confirm: true });
    expect(r.ok).toBe(true);
    expect(tables.lesson_slots.some((s) => s.id === SLOT_MANUAL)).toBe(false);
    expect(mail).toHaveLength(1);
    expect(mail[0].payload.to).toBe('pat@x.com');
    expect(mail[0].payload.subject).toBe('Lesson Cancelled: Your lesson with Julia Ruiz has been cancelled');
  });

  it("refuses Open Lesson Time bookings and other clubs' lessons", async () => {
    const { pack, log } = setup();
    expect(((await pack.execute('cancel_lesson', { lesson_id: SLOT_OPEN, confirm: true })) as any).error).toMatch(/Open Lesson Time/);
    expect(((await pack.execute('cancel_lesson', { lesson_id: SLOT_OTHER_CLUB, confirm: true })) as any).ok).toBe(false);
    expect(realWrites(log)).toHaveLength(0);
    expect(mail).toHaveLength(0);
  });

  it('a coach may cancel their own lesson but not a colleague\'s', async () => {
    const { pack } = setup('coach', 'u-shannon');
    expect(((await pack.execute('cancel_lesson', { lesson_id: SLOT_MANUAL, confirm: true })) as any).ok).toBe(false);
    const own: any = await pack.execute('cancel_lesson', { lesson_id: SLOT_SHANNON, confirm: true });
    expect(own.ok).toBe(true);
    expect(own.emailed).toBe('nobody');
  });
});

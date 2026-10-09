import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * What these guard:
 *   1. PREVIEW AND RUN AGREE — the run sends exactly the subject, body and
 *      inboxes the preview showed, and refuses if any of them moved.
 *   2. NOTHING IS SENT WITHOUT confirm:true (and a send_key from a preview).
 *   3. HOUSEHOLDS — one email per inbox, every person behind it named.
 *   4. The unsubscribe list is honoured and shown; the cap is enforced.
 *   5. SCOPING — another club's classes, people and addresses are unreachable.
 *
 * Only the last hop is replaced: sendBilledEmails (the shared paced sender) and
 * the unsubscribe writers. Everything that decides who gets what is real.
 */

type Payload = { to: string; subject: string; html: string; fromName?: string; clubId?: string; replyTo?: string };
const sent: { userId: string | null; payloads: Payload[] }[] = [];
vi.mock('@/lib/email', () => {
  class CreditLimitError extends Error {
    kind = 'emails';
    tier = 'free';
    limit = 0;
  }
  return {
    sendBilledEmails: vi.fn(async (userId: string | null, payloads: Payload[]) => {
      sent.push({ userId, payloads });
      return payloads.map(() => ({ sent: true }));
    }),
    CreditLimitError,
  };
});

let currentDb: ReturnType<typeof fakeDb> | null = null;
vi.mock('@/lib/emailUnsubscribe', () => ({
  recordUnsubscribe: vi.fn(async (email: string) => {
    currentDb!.tables.email_unsubscribes.push({ email: email.toLowerCase(), scope: 'all', unsubscribed_at: '2026-10-09T00:00:00Z' });
    currentDb!.log.push({ op: 'unsubscribe', table: 'email_unsubscribes' });
    return { success: true };
  }),
  removeUnsubscribe: vi.fn(async (email: string) => {
    const t = currentDb!.tables.email_unsubscribes;
    const i = t.findIndex((r) => r.email === email.toLowerCase());
    if (i >= 0) t.splice(i, 1);
    currentDb!.log.push({ op: 'resubscribe', table: 'email_unsubscribes' });
    return { success: true };
  }),
}));

import { bindPack } from '../framework';
import { commsPack, ageOn, nameMatches, SEND_CAP } from './comms';

const TZ = 'America/Los_Angeles';
type Row = Record<string, any>;

function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  tables.email_unsubscribes ??= [];
  const log: { op: string; table: string }[] = [];

  function from(table: string) {
    const rows = (tables[table] ??= []);
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: any;
    const filters: ((r: Row) => boolean)[] = [];
    let limit: number | undefined;
    const exec = async () => {
      if (op !== 'select') {
        log.push({ op, table });
        if (op === 'insert') rows.push(...(Array.isArray(payload) ? payload : [payload]));
        return { data: [], error: null };
      }
      let hit = rows.filter((r) => filters.every((f) => f(r)));
      if (limit != null) hit = hit.slice(0, limit);
      return { data: hit, error: null };
    };
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) === String(v)), q),
      neq: (c: string, v: unknown) => (filters.push((r) => String(r[c]) !== String(v)), q),
      in: (c: string, v: unknown[]) => (filters.push((r) => v.map(String).includes(String(r[c]))), q),
      gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), q),
      lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
      order: () => q,
      limit: (n: number) => ((limit = n), q),
      insert: (p: unknown) => ((op = 'insert'), (payload = p), q),
      update: (p: unknown) => ((op = 'update'), (payload = p), q),
      delete: () => ((op = 'delete'), q),
      maybeSingle: () => exec().then((r) => ({ ...r, data: r.data[0] ?? null })),
      then: (ok: any, bad: any) => exec().then(ok, bad),
    };
    return q;
  }
  const auth = { admin: { getUserById: async (id: string) => ({ data: { user: id === 'u1' ? { email: 'director@club.com' } : null } }) } };
  return { db: { from, auth }, tables, log, writes: () => log };
}

const P = (id: string, title: string, start: string, end: string, club = 'c1', status = 'published') => ({
  id, club_id: club, title, status, range_start: start, range_end: end, audience: 'junior',
});
const PAST = '11111111-1111-4111-8111-111111111111';
const CURRENT = '22222222-2222-4222-8222-222222222222';
const FUTURE = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';

const reg = (program_id: string, participant_name: string, parent_email: string | null, extra: Row = {}) => ({
  id: `r-${participant_name}`,
  program_id,
  club_id: 'c1',
  participant_name,
  participant_dob: null,
  parent_name: null,
  parent_email,
  status: 'enrolled',
  ...extra,
});

function seed() {
  return {
    cc_clubs: [
      { id: 'c1', owner_id: 'owner1', email: 'club@club.com' },
      { id: 'c2', owner_id: 'owner2', email: 'other@club.com' },
    ],
    club_programs: [
      P(PAST, 'Tennis 101 (Summer)', '2026-06-01', '2026-08-01', 'c1', 'archived'),
      P(CURRENT, 'Tennis 101 (Fall)', '2026-09-01', '2026-11-01'),
      P(FUTURE, 'Tennis 101 (Winter)', '2027-01-10', '2027-03-01', 'c1', 'draft'),
      P(OTHER, 'Tennis 101', '2026-09-01', '2026-11-01', 'c2'),
    ],
    club_program_registrations: [
      reg(PAST, 'Emma Yang', 'grace@yang.com', { parent_name: 'Grace Yang', participant_dob: '2016-03-01' }),
      reg(CURRENT, 'Leo Yang', 'Grace@Yang.com', { parent_name: 'Grace Yang', participant_dob: '2018-05-01' }),
      reg(CURRENT, 'Sam Lee', 'lee@x.com', { participant_dob: '2010-01-01' }),
      reg(CURRENT, 'Nora Park', null),
      reg(CURRENT, 'Gone Kid', 'gone@x.com', { status: 'cancelled' }),
      reg(CURRENT, 'Wait Kid', 'wait@x.com', { status: 'waitlist' }),
      reg(PAST, 'Ava Cruz', 'cruz@x.com'),
      { ...reg(OTHER, 'Other Club Kid', 'otherkid@x.com'), club_id: 'c2' },
    ],
    cc_vault_players: [
      { id: 'v1', club_id: 'c1', full_name: 'Jane Smith', email: 'jane@smith.com', date_of_birth: null, age: null },
      { id: 'v2', club_id: 'c2', full_name: 'Zed Other', email: 'zed@other.com', date_of_birth: null, age: null },
    ],
    email_unsubscribes: [{ email: 'lee@x.com', scope: 'all', unsubscribed_at: '2026-01-01T00:00:00Z' }],
  };
}

const BODY = 'Hi all,\n\nThe new Tennis 101 session starts Saturday. Sign up: https://club.com/reg\n\nDarrin';
const AUD = { classes: ['Tennis 101'] };

let f: ReturnType<typeof fakeDb>;
function pack(role = 'director', clubId = 'c1') {
  const ctx = { userId: 'u1', db: f.db as any, clubId, clubName: 'Test Club', clubSlug: 'test', timeZone: TZ, role };
  return bindPack(commsPack, ctx as any);
}

beforeEach(() => {
  sent.length = 0;
  f = fakeDb(seed());
  currentDb = f;
});

describe('helpers', () => {
  it('ageOn counts birthdays', () => {
    expect(ageOn('2014-10-10', '2026-10-09')).toBe(11);
    expect(ageOn('2014-10-09', '2026-10-09')).toBe(12);
    expect(ageOn(null, '2026-10-09')).toBeNull();
  });
  it('nameMatches by whole words, forgiving a plural', () => {
    expect(nameMatches('the Yangs', 'Emma Yang')).toBe(true);
    expect(nameMatches('Yang', 'Emma Yangtze')).toBe(false);
    expect(nameMatches('Emma Yang', 'Leo Yang')).toBe(false);
  });
});

describe('send_email', () => {
  it('previews without sending, and the confirmed run sends exactly what was previewed', async () => {
    const p = pack();
    const prev: any = await p.execute('send_email', { subject: 'New session', body: BODY, audience: AUD });
    expect(prev.ok).toBe(true);
    expect(prev.needsConfirm).toBe(true);
    expect(sent).toHaveLength(0);
    expect(prev.will.subject).toBe('New session');
    expect(prev.will.body).toBe(BODY);
    expect(prev.will.recipient_count).toBe(2); // grace@yang.com + cruz@x.com
    expect(prev.send_key).toMatch(/^[0-9a-f]{16}$/);

    const done: any = await p.execute('send_email', { subject: 'New session', body: BODY, audience: AUD, send_key: prev.send_key, confirm: true });
    expect(done.ok).toBe(true);
    expect(done.delivered).toBe(2);
    expect(sent).toHaveLength(1);
    const { userId, payloads } = sent[0];
    expect(userId).toBe('owner1');
    expect(payloads.map((x) => x.to).sort()).toEqual(['cruz@x.com', 'grace@yang.com']);
    for (const x of payloads) {
      expect(x.subject).toBe('New session');
      expect(x.fromName).toBe('Test Club');
      expect(x.clubId).toBe('c1');
      expect(x.replyTo).toBe('club@club.com');
      expect(x.html).toContain('href="https://club.com/reg"');
      expect(x.html).toContain('The new Tennis 101 session starts Saturday.');
    }
  });

  it('dedupes a household by inbox and keeps every name', async () => {
    const prev: any = await pack().execute('send_email', { subject: 's', body: 'b', audience: AUD });
    const yang = prev.will.recipients.find((l: string) => l.includes('grace@yang.com'));
    expect(yang).toContain('Emma Yang & Leo Yang');
    expect(prev.will.people_count).toBe(3);
    expect(prev.will.shared_inboxes).toMatch(/1 inbox is shared/);
  });

  it('excludes and names the unsubscribed, the unreachable and the cancelled', async () => {
    const prev: any = await pack().execute('send_email', { subject: 's', body: 'b', audience: AUD });
    const ex = prev.will.not_sent_to;
    expect(ex.unsubscribed).toEqual(['Sam Lee — lee@x.com']);
    expect(ex.no_email_on_file).toEqual(['Nora Park']);
    const all = JSON.stringify(prev.will);
    expect(all).not.toContain('gone@x.com');
    expect(all).not.toContain('wait@x.com'); // waitlist only on request
  });

  it('refuses without a send_key, or when the body or the list changed since the preview', async () => {
    const p = pack();
    const prev: any = await p.execute('send_email', { subject: 's', body: BODY, audience: AUD });
    const noKey: any = await p.execute('send_email', { subject: 's', body: BODY, audience: AUD, confirm: true });
    expect(noKey.ok).toBe(false);
    const rewritten: any = await p.execute('send_email', { subject: 's', body: BODY + ' more', audience: AUD, send_key: prev.send_key, confirm: true });
    expect(rewritten.ok).toBe(false);
    f.tables.club_program_registrations.push(reg(CURRENT, 'New Kid', 'new@x.com'));
    const moved: any = await p.execute('send_email', { subject: 's', body: BODY, audience: AUD, send_key: prev.send_key, confirm: true });
    expect(moved.ok).toBe(false);
    expect(moved.error).toMatch(/not the email that was previewed/);
    expect(sent).toHaveLength(0);
  });

  it('enforces the cap', async () => {
    for (let i = 0; i <= SEND_CAP; i++) f.tables.club_program_registrations.push(reg(CURRENT, `Kid ${i}`, `k${i}@x.com`));
    const prev: any = await pack().execute('send_email', { subject: 's', body: 'b', audience: AUD });
    expect(prev.ok).toBe(false);
    expect(prev.error).toMatch(new RegExp(`up to ${SEND_CAP}`));
    expect(sent).toHaveLength(0);
  });

  it('never reaches another club', async () => {
    const prev: any = await pack().execute('send_email', { subject: 's', body: 'b', audience: AUD });
    expect(JSON.stringify(prev)).not.toContain('otherkid@x.com');
    const byId: any = await pack().execute('preview_recipients', { audience: { classes: [OTHER] } });
    expect(byId.ok).toBe(false);
    const person: any = await pack().execute('preview_recipients', { audience: { people: ['Zed Other'] } });
    expect(person.ok).toBe(false);
    const vault: any = await pack().execute('preview_recipients', { audience: { club_players: true } });
    expect(vault.recipients).toEqual(['Jane Smith — jane@smith.com']);
  });

  it('a coach cannot send', async () => {
    const r: any = await pack('coach').execute('send_email', { subject: 's', body: 'b', audience: AUD });
    expect(r.ok).toBe(false);
    const t: any = await pack('coach').execute('send_test_email', { subject: 's', body: 'b' });
    expect(t.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('one-off to a named person, and "the last session" picks the latest started class', async () => {
    const one: any = await pack().execute('send_email', { subject: 's', body: 'b', audience: { people: ['Jane Smith'] } });
    expect(one.will.recipients).toEqual(['Jane Smith — jane@smith.com']);
    const last: any = await pack().execute('preview_recipients', { audience: { classes: ['Tennis 101'], class_scope: 'most_recent_started' } });
    expect(last.audience[0]).toContain('Tennis 101 (Fall)');
    expect(last.recipients).toEqual(['Leo Yang — grace@yang.com (Grace Yang)']);
  });

  it('age filter keeps only known ages in range and lists the unknown', async () => {
    const r: any = await pack().execute('preview_recipients', { audience: { classes: ['Tennis 101'], max_age: 12 } });
    // Emma (10) and Leo (8) in; Sam (16) out; Ava has no birth date.
    expect(r.recipients).toEqual(['Emma Yang & Leo Yang — grace@yang.com (Grace Yang)']);
    expect(r.not_sent_to.age_unknown).toContain('Ava Cruz');
    expect(r.not_sent_to.outside_age_range).toBe(1);
  });
});

describe('send_test_email', () => {
  it('goes only to the director', async () => {
    const r: any = await pack().execute('send_test_email', { subject: 'New session', body: BODY, audience: AUD });
    expect(r.ok).toBe(true);
    expect(r.would_go_to).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].payloads).toHaveLength(1);
    expect(sent[0].payloads[0].to).toBe('director@club.com');
    expect(sent[0].payloads[0].subject).toBe('[Test] New session');
  });
});

describe('stop_emails_to / resume_emails_to', () => {
  it('previews, then writes the unsubscribe list only on confirm; and can undo', async () => {
    const p = pack();
    const prev: any = await p.execute('stop_emails_to', { people: ['the Yangs'] });
    expect(prev.ok).toBe(true);
    expect(prev.will.stop_emailing[0]).toContain('grace@yang.com');
    expect(f.writes()).toHaveLength(0);
    const done: any = await p.execute('stop_emails_to', { people: ['the Yangs'], confirm: true });
    expect(done.ok).toBe(true);
    expect(f.tables.email_unsubscribes.map((r) => r.email)).toContain('grace@yang.com');

    const after: any = await p.execute('preview_recipients', { audience: AUD });
    expect(after.not_sent_to.unsubscribed.join()).toContain('grace@yang.com');

    const back: any = await p.execute('resume_emails_to', { emails: ['grace@yang.com'], confirm: true });
    expect(back.ok).toBe(true);
    expect(f.tables.email_unsubscribes.map((r) => r.email)).not.toContain('grace@yang.com');
  });

  it("refuses another club's address", async () => {
    const r: any = await pack().execute('stop_emails_to', { emails: ['otherkid@x.com'], confirm: true });
    expect(r.ok).toBe(false);
    expect(f.writes()).toHaveLength(0);
  });
});

describe('unsupported', () => {
  it('scheduling and open tracking say no', async () => {
    expect((await pack().execute('schedule_email', { send_at: 'tomorrow 8am' })).ok).toBe(false);
    expect((await pack().execute('email_delivery_status', {})).ok).toBe(false);
  });
});

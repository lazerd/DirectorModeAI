/**
 * The send gate.
 *
 * safeResendSend is mocked because the thing under test is not the unsubscribe
 * wrapper (which has its own tests) but the four questions this module asks
 * before it reaches the wrapper at all, and the one it asks afterwards: is the
 * row APPROVED, is the club suppressed, has it heard from us this month, and
 * did the demo guard quietly swallow the result.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const safeResendSend = vi.fn();
vi.mock('@/lib/emailUnsubscribe', () => ({ safeResendSend: (...a: unknown[]) => safeResendSend(...a) }));
vi.mock('resend', () => ({ Resend: class {} }));

import { sendQueued } from './send';
import type { QueueRow } from './types';

process.env.CRM_POSTAL_ADDRESS = '1572 Hillgrade Ave, Alamo, CA 94507';

const ROW: QueueRow = {
  id: 'q1',
  org_id: 'o1',
  contact_id: 'c1',
  rep_email: 'darrinjco@gmail.com',
  send_date: '2026-09-16',
  subject: 'A question about Test Club',
  body: 'Hi Sam,\n\nI built a thing. Worth 15 minutes?',
  why: 'West region, one contact, nobody has ever been written to.',
  status: 'approved',
  kind: 'intro',
  follow_up_of: null,
  generated_by: 'model',
  approved_at: '2026-09-16T15:00:00Z',
  sent_at: null,
  resend_id: null,
  reject_reason: null,
  detail: null,
  dedupe_key: 'o1:intro',
  created_at: '2026-09-16T13:00:00Z',
  updated_at: '2026-09-16T13:00:00Z',
};

/**
 * A fake PostgREST builder. Every filter returns `this`; awaiting it resolves
 * whatever the scenario put under that table. Writes are recorded so a test
 * can assert the ledger row exists without a database.
 */
interface Scenario {
  queueStatus?: string;
  org?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  suppressed?: boolean;
  recentSends?: number;
}

function fakeDb(s: Scenario) {
  const writes: { table: string; op: 'insert' | 'update'; payload: unknown }[] = [];
  const db = {
    from(table: string) {
      const result = (): unknown => {
        switch (table) {
          case 'crm_outreach_queue':
            return { data: { status: s.queueStatus ?? 'approved' } };
          case 'crm_orgs':
            return { data: s.org === undefined ? { id: 'o1', name: 'Test Club', region: 'West' } : s.org };
          case 'crm_contacts':
            return {
              data:
                s.contact === undefined
                  ? { id: 'c1', org_id: 'o1', full_name: 'Sam Reed', email: 'sam@example.com', do_not_contact: false }
                  : s.contact,
            };
          case 'crm_outreach_suppression':
            return { data: s.suppressed ? [{ id: 'sup1' }] : [] };
          case 'crm_email_sends':
            return { data: [], count: s.recentSends ?? 0 };
          default:
            return { data: null, count: 0 };
        }
      };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        or: () => builder,
        gte: () => builder,
        in: () => builder,
        lte: () => builder,
        ilike: () => builder,
        is: () => builder,
        not: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve(result()),
        insert: (payload: unknown) => {
          writes.push({ table, op: 'insert', payload });
          return Promise.resolve({ error: null });
        },
        update: (payload: unknown) => {
          writes.push({ table, op: 'update', payload });
          return builder;
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res),
      };
      return builder;
    },
    writes,
  };
  return db as unknown as Parameters<typeof sendQueued>[0] & { writes: typeof writes };
}

const resend = { emails: { send: vi.fn() } };

beforeEach(() => {
  safeResendSend.mockReset();
  safeResendSend.mockResolvedValue({ sent: true, messageId: 're_fake_1' });
});

describe('approved is required to send', () => {
  it('refuses a planned row and never touches Resend', async () => {
    const db = fakeDb({ queueStatus: 'planned' });
    const r = await sendQueued(db, { ...ROW, status: 'planned' }, { resend });
    expect(r.outcome).toBe('skipped');
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  it('refuses a rejected row', async () => {
    const db = fakeDb({ queueStatus: 'rejected' });
    expect((await sendQueued(db, ROW, { resend })).outcome).toBe('skipped');
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  it('refuses a snoozed row', async () => {
    const db = fakeDb({ queueStatus: 'snoozed' });
    expect((await sendQueued(db, ROW, { resend })).outcome).toBe('skipped');
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  it('re-reads the row rather than trusting the caller — a stale "approved" in hand is not enough', async () => {
    // The row object says approved; the database says it was undone.
    const db = fakeDb({ queueStatus: 'planned' });
    expect((await sendQueued(db, { ...ROW, status: 'approved' }, { resend })).outcome).toBe('skipped');
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  it('sends an approved row', async () => {
    const db = fakeDb({});
    const r = await sendQueued(db, ROW, { resend });
    expect(r.outcome).toBe('sent');
    expect(safeResendSend).toHaveBeenCalledTimes(1);
  });
});

describe('what goes on the wire', () => {
  it('comes from the outreach domain, never mail.clubmode.ai', async () => {
    await sendQueued(fakeDb({}), ROW, { resend });
    const arg = safeResendSend.mock.calls[0][1] as { from: string; replyTo: string };
    expect(arg.from).toContain('outreach.clubmode.ai');
    expect(arg.from).not.toContain('mail.clubmode.ai');
  });

  it('replies to the rep who approved it', async () => {
    await sendQueued(fakeDb({}), ROW, { resend });
    const arg = safeResendSend.mock.calls[0][1] as { replyTo: string };
    expect(arg.replyTo).toBe('darrinjco@gmail.com');
  });

  it('passes NO club scoping, so the demo guard cannot claim it', async () => {
    await sendQueued(fakeDb({}), ROW, { resend });
    const arg = safeResendSend.mock.calls[0][1] as Record<string, unknown>;
    expect(arg.clubId).toBeUndefined();
    expect(arg.clubSlug).toBeUndefined();
    expect(arg.billToUserId).toBeUndefined();
  });

  it('carries the postal address and a plain opt-out line', async () => {
    await sendQueued(fakeDb({}), ROW, { resend });
    const arg = safeResendSend.mock.calls[0][1] as { html: string };
    expect(arg.html).toContain('1572 Hillgrade Ave');
    expect(arg.html).toContain("Tell me to stop and I won't write again.");
  });

  it('refuses outright with no postal address configured', async () => {
    const saved = process.env.CRM_POSTAL_ADDRESS;
    process.env.CRM_POSTAL_ADDRESS = '';
    const r = await sendQueued(fakeDb({}), ROW, { resend });
    process.env.CRM_POSTAL_ADDRESS = saved;
    expect(r.outcome).toBe('blocked');
    expect(safeResendSend).not.toHaveBeenCalled();
  });
});

describe('the traps', () => {
  it('surfaces a demo hold as a REFUSAL, never as a send', async () => {
    safeResendSend.mockResolvedValue({ sent: true, messageId: 'demo-suppressed', demo: 'demo_club' });
    const db = fakeDb({});
    const r = await sendQueued(db, ROW, { resend });
    expect(r.outcome).toBe('held');
    expect(r.message).toContain('NOT SENT');
    // And the queue row is failed, not sent.
    const update = db.writes.find((w) => w.table === 'crm_outreach_queue' && w.op === 'update');
    expect((update?.payload as { status: string }).status).toBe('failed');
    // And no activity claims the club heard from us.
    expect(db.writes.some((w) => w.table === 'crm_activities')).toBe(false);
  });

  it('stops a card that was suppressed after it was approved', async () => {
    const r = await sendQueued(fakeDb({ suppressed: true }), ROW, { resend });
    expect(r.outcome).toBe('blocked');
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  it('honours the 30-day floor against the ledger, not just its own queue', async () => {
    const r = await sendQueued(fakeDb({ recentSends: 1 }), ROW, { resend });
    expect(r.outcome).toBe('blocked');
    expect(r.message).toContain('30 days');
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  it('records an unsubscribe as blocked and suppresses the address', async () => {
    safeResendSend.mockResolvedValue({ sent: false, reason: 'unsubscribed' });
    const db = fakeDb({});
    const r = await sendQueued(db, ROW, { resend });
    expect(r.outcome).toBe('blocked');
    expect(db.writes.some((w) => w.table === 'crm_outreach_suppression' && w.op === 'insert')).toBe(true);
  });
});

describe('the paper trail', () => {
  it('writes a ledger row and a timeline note on a real send', async () => {
    const db = fakeDb({});
    await sendQueued(db, ROW, { resend });
    expect(db.writes.some((w) => w.table === 'crm_email_sends' && w.op === 'insert')).toBe(true);
    expect(db.writes.some((w) => w.table === 'crm_activities' && w.op === 'insert')).toBe(true);
  });

  it('moves the club to contacted', async () => {
    const db = fakeDb({});
    await sendQueued(db, ROW, { resend });
    const orgUpdate = db.writes.find((w) => w.table === 'crm_orgs' && w.op === 'update');
    expect((orgUpdate?.payload as { stage: string }).stage).toBe('contacted');
  });

  it('writes no timeline note when the send was only attempted', async () => {
    safeResendSend.mockResolvedValue({ sent: false, reason: 'error', error: 'boom' });
    const db = fakeDb({});
    expect((await sendQueued(db, ROW, { resend })).outcome).toBe('failed');
    expect(db.writes.some((w) => w.table === 'crm_activities')).toBe(false);
    expect(db.writes.some((w) => w.table === 'crm_email_sends' && w.op === 'insert')).toBe(true);
  });
});

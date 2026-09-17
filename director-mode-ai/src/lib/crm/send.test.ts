import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The send path, with Resend stubbed.
 *
 * The case this exists for is the demo guard. safeResendSend returns
 * `{ sent: true, messageId: 'demo-suppressed' }` when it holds a message —
 * success-shaped, because for a demo tour that IS success. If the CRM ever
 * treats that as a send, Darrin writes to a club president, sees "Sent", and
 * nothing left the building. Two of our three prospects are demo_mode clubs,
 * so this is not hypothetical.
 *
 * Also pinned here: a real send writes BOTH the ledger row and the activity
 * row, and nothing else does. That was verified in the browser as far as it
 * could be — the live attempt was refused by the app's own unsubscribe
 * blocklist — so the assertion lives here where it can run every time.
 */

const safeResendSend = vi.fn();
vi.mock('@/lib/emailUnsubscribe', () => ({ safeResendSend: (...a: unknown[]) => safeResendSend(...a) }));
vi.mock('resend', () => ({ Resend: class { constructor(_k?: string) {} } }));

const { sendCrmEmail, HOURLY_CAP } = await import('./send');
import type { Contact, Org } from './types';

const ORG = {
  id: 'o1',
  name: 'Rossmoor Tennis Club',
  demo_url: 'https://clubmode.ai/demo/abc',
  next_step: 'Warm intro',
} as Org;

const CONTACT = {
  id: 'c1',
  org_id: 'o1',
  full_name: 'Mary Benin',
  email: 'mary.benin@example-not-real.test',
  do_not_contact: false,
} as Contact;

/** A Supabase-shaped stub: records inserts, answers the rate-limit count. */
function fakeDb(sentInLastWindow = 0) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
        select() {
          const chain = {
            eq: () => chain,
            gte: () => Promise.resolve({ count: sentInLastWindow }),
          };
          return chain;
        },
      };
    },
  };
  return { db: db as never, inserts };
}

const base = {
  org: ORG,
  contact: CONTACT,
  repName: 'Darrin Cohen',
  repEmail: 'darrinjco@gmail.com',
  subject: 'A question about {{club}}',
  body: 'Hi {{first_name}}, here is {{demo_url}}.',
  templateSlug: 'intro-warm',
};

beforeEach(() => {
  safeResendSend.mockReset();
  process.env.CRM_POSTAL_ADDRESS = '1 Main St, Walnut Creek, CA 94595';
});
afterEach(() => {
  delete process.env.CRM_POSTAL_ADDRESS;
});

const ledger = (inserts: { table: string; row: Record<string, unknown> }[]) =>
  inserts.filter((i) => i.table === 'crm_email_sends');
const activity = (inserts: { table: string; row: Record<string, unknown> }[]) =>
  inserts.filter((i) => i.table === 'crm_activities');

describe('sendCrmEmail', () => {
  it('records a ledger row AND an activity row on a real send', async () => {
    safeResendSend.mockResolvedValue({ sent: true, messageId: 'msg_1' });
    const { db, inserts } = fakeDb();
    const out = await sendCrmEmail({ db, ...base });

    expect(out.status).toBe('sent');
    expect(ledger(inserts)).toHaveLength(1);
    expect(ledger(inserts)[0].row).toMatchObject({
      status: 'sent',
      to_email: CONTACT.email,
      reply_to: 'ClubMode <hello@clubmode.ai>',
      subject: 'A question about Rossmoor Tennis Club',
      message_id: 'msg_1',
      template_slug: 'intro-warm',
      sent_by_email: 'darrinjco@gmail.com',
    });

    expect(activity(inserts)).toHaveLength(1);
    const a = activity(inserts)[0].row;
    expect(a).toMatchObject({ org_id: 'o1', contact_id: 'c1', kind: 'email', created_by_email: 'darrinjco@gmail.com' });
    // The body carries who it went to, the subject and what was said, so both
    // reps can read the thread months later without opening Resend.
    expect(String(a.body)).toContain('Mary Benin');
    expect(String(a.body)).toContain('A question about Rossmoor Tennis Club');
    expect(String(a.body)).toContain('Hi Mary, here is https://clubmode.ai/demo/abc.');
  });

  it('sends with no club attribution at all, so the demo guard cannot claim it', async () => {
    safeResendSend.mockResolvedValue({ sent: true, messageId: 'msg_2' });
    const { db } = fakeDb();
    await sendCrmEmail({ db, ...base });

    const payload = safeResendSend.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.clubId).toBeUndefined();
    expect(payload.clubSlug).toBeUndefined();
    expect(payload.billToUserId).toBeUndefined();
    expect(payload.from).toContain('@mail.clubmode.ai');
    expect(payload.replyTo).toBe('ClubMode <hello@clubmode.ai>');
  });

  /* ----------------------------------------------------- the important one */
  it('treats a demo hold as NOT SENT, and writes no activity row', async () => {
    safeResendSend.mockResolvedValue({ sent: true, messageId: 'demo-suppressed', demo: 'demo_club' });
    const { db, inserts } = fakeDb();
    const out = await sendCrmEmail({ db, ...base });

    expect(out.status).toBe('held');
    expect(out.message).toContain('NOT SENT');
    expect(out.message).toContain('demo_club');
    expect(ledger(inserts)[0].row).toMatchObject({ status: 'held', detail: 'demo_guard:demo_club' });
    // The timeline must not claim this prospect has heard from us.
    expect(activity(inserts)).toHaveLength(0);
  });

  it('records an unsubscribed recipient as blocked, not sent', async () => {
    safeResendSend.mockResolvedValue({ sent: false, reason: 'unsubscribed' });
    const { db, inserts } = fakeDb();
    const out = await sendCrmEmail({ db, ...base });
    expect(out.status).toBe('blocked');
    expect(ledger(inserts)[0].row).toMatchObject({ status: 'blocked', detail: 'unsubscribed' });
    expect(activity(inserts)).toHaveLength(0);
  });

  it('records a failure with the error, and writes no activity row', async () => {
    safeResendSend.mockResolvedValue({ sent: false, reason: 'error', error: 'domain not verified' });
    const { db, inserts } = fakeDb();
    const out = await sendCrmEmail({ db, ...base });
    expect(out.status).toBe('failed');
    expect(ledger(inserts)[0].row).toMatchObject({ status: 'failed', detail: 'domain not verified' });
    expect(activity(inserts)).toHaveLength(0);
  });

  // ------------------------------------------------- refused before Resend
  it('never calls Resend for a do-not-contact person', async () => {
    const { db, inserts } = fakeDb();
    const out = await sendCrmEmail({ db, ...base, contact: { ...CONTACT, do_not_contact: true } });
    expect(out.status).toBe('blocked');
    expect(safeResendSend).not.toHaveBeenCalled();
    expect(ledger(inserts)[0].row.detail).toContain('do_not_contact');
  });

  it('never calls Resend without a postal address', async () => {
    delete process.env.CRM_POSTAL_ADDRESS;
    const { db, inserts } = fakeDb();
    const out = await sendCrmEmail({ db, ...base });
    expect(out.status).toBe('blocked');
    expect(safeResendSend).not.toHaveBeenCalled();
    expect(ledger(inserts)[0].row.detail).toContain('no_postal_address');
  });

  it('never calls Resend when a merge field did not fill in', async () => {
    const { db } = fakeDb();
    const out = await sendCrmEmail({ db, ...base, org: { ...ORG, demo_url: null } as Org });
    expect(out.status).toBe('blocked');
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  it('stops a rep who has hit the hourly cap', async () => {
    safeResendSend.mockResolvedValue({ sent: true, messageId: 'x' });
    const { db, inserts } = fakeDb(HOURLY_CAP);
    const out = await sendCrmEmail({ db, ...base });
    expect(out.status).toBe('blocked');
    expect(safeResendSend).not.toHaveBeenCalled();
    expect(ledger(inserts)[0].row.detail).toBe('hourly_cap');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The cron, with Resend stubbed.
 *
 * The case this file exists for is the one that cannot be tested by hand: a
 * rep cancels an email at 7:59 and the tick that fires at 8:00 must not send
 * it. That is decided by Postgres — the claim is an UPDATE ... WHERE status =
 * 'scheduled' — so the fake below models exactly that, and the assertion is
 * that Resend was never called at all.
 *
 * The rest is the same set of "Tuesday's approval is not Thursday's
 * permission" re-checks, each of which must write its reason onto the row
 * rather than dropping the email on the floor.
 */

const safeResendSend = vi.fn();
vi.mock('@/lib/emailUnsubscribe', () => ({ safeResendSend: (...a: unknown[]) => safeResendSend(...a) }));
vi.mock('resend', () => ({ Resend: class { constructor(_k?: string) {} } }));

const { sendDueScheduled } = await import('./scheduledSend');

const NOW = new Date('2026-09-18T15:00:00Z');

function row(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    org_id: 'o1',
    contact_id: 'c1',
    to_email: 'mary.benin@example-not-real.test',
    subject: 'A question about Rossmoor Tennis Club',
    body: 'Hi Mary,\n\nWorth 15 minutes?',
    template_slug: 'intro-warm',
    send_at: '2026-09-18T15:00:00Z',
    rep_email: 'darrinjco@gmail.com',
    rep_name: 'Darrin Cohen',
    status: 'scheduled',
    attempts: 0,
    created_by_email: 'darrinjco@gmail.com',
    ...over,
  };
}

const ORG = { id: 'o1', name: 'Rossmoor Tennis Club', demo_url: 'https://x.test/d', next_step: 'Intro' };
const CONTACT = {
  id: 'c1',
  org_id: 'o1',
  full_name: 'Mary Benin',
  email: 'mary.benin@example-not-real.test',
  do_not_contact: false,
};

/**
 * A Supabase-shaped fake with one scheduled row and a real claim.
 *
 * `cancelBeforeClaim` flips the row to 'cancelled' the instant after it has
 * been read but before the claim runs — the exact race the claim exists for.
 */
function fakeDb(opts: {
  scheduled?: Record<string, unknown>[];
  org?: Record<string, unknown> | null;
  contact?: Record<string, unknown> | null;
  rep?: { active: boolean } | null;
  cancelBeforeClaim?: boolean;
} = {}) {
  const store = new Map<string, Record<string, unknown>>();
  for (const r of opts.scheduled ?? [row()]) store.set(String(r.id), { ...r });
  const inserts: { table: string; row: Record<string, unknown> }[] = [];

  function scheduledTable() {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (k: string, v: unknown) => {
        filters[k] = v;
        return chain;
      },
      in: () => chain,
      lt: () => chain,
      lte: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: () =>
        Promise.resolve({ data: store.get(String(filters.id)) ?? null, error: null }),
      update(p: Record<string, unknown>) {
        patch = p;
        return chain;
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        // A read or a write, resolved when awaited.
        if (patch) {
          const hit: Record<string, unknown>[] = [];
          for (const [id, r] of store) {
            if (filters.id !== undefined && filters.id !== id) continue;
            if (filters.status !== undefined && r.status !== filters.status) continue;
            Object.assign(r, patch);
            hit.push(r);
          }
          return resolve({ data: hit, error: null });
        }
        const rows = [...store.values()].filter((r) => r.status === 'scheduled');
        if (opts.cancelBeforeClaim) {
          // The rep hits Cancel between the SELECT and the UPDATE.
          for (const r of store.values()) r.status = 'cancelled';
        }
        return resolve({ data: rows, error: null });
      },
    };
    return chain;
  }

  const db = {
    from(table: string) {
      if (table === 'crm_scheduled_emails') return scheduledTable();
      if (table === 'crm_orgs' || table === 'crm_contacts') {
        const c: Record<string, unknown> = {
          select: () => c,
          eq: () => c,
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'crm_orgs'
                  ? opts.org === undefined
                    ? ORG
                    : opts.org
                  : opts.contact === undefined
                    ? CONTACT
                    : opts.contact,
            }),
        };
        return c;
      }
      if (table === 'crm_users') {
        const c: Record<string, unknown> = {
          select: () => c,
          eq: () => c,
          maybeSingle: () =>
            Promise.resolve({ data: opts.rep === undefined ? { active: true } : opts.rep }),
        };
        return c;
      }
      // The ledger and the timeline, written by sendCrmEmail.
      const c: Record<string, unknown> = {
        insert(r: Record<string, unknown>) {
          inserts.push({ table, row: r });
          return Promise.resolve({ error: null });
        },
        select: () => {
          const s: Record<string, unknown> = {
            eq: () => s,
            gte: () => Promise.resolve({ count: 0 }),
          };
          return s;
        },
      };
      return c;
    },
  };
  return { db: db as never, store, inserts };
}

beforeEach(() => {
  safeResendSend.mockReset();
  safeResendSend.mockResolvedValue({ sent: true, messageId: 'msg_1' });
  process.env.CRM_POSTAL_ADDRESS = '1 Main St, Walnut Creek, CA 94595';
  // The allowlist check falls back to the platform owner list otherwise.
  process.env.PLATFORM_OWNER_EMAILS = 'darrinjco@gmail.com';
});
afterEach(() => {
  delete process.env.CRM_POSTAL_ADDRESS;
});

describe('sendDueScheduled', () => {
  it('sends a due row through the ordinary send path', async () => {
    const { db, store, inserts } = fakeDb();
    const report = await sendDueScheduled(db, NOW);

    expect(report.sent).toBe(1);
    expect(safeResendSend).toHaveBeenCalledTimes(1);
    expect(store.get('s1')!.status).toBe('sent');

    // The same ledger row and the same activity row an immediate send writes.
    expect(inserts.filter((i) => i.table === 'crm_email_sends')).toHaveLength(1);
    expect(inserts.filter((i) => i.table === 'crm_activities')).toHaveLength(1);

    // And with no club attribution, so the demo guard cannot claim it.
    const payload = safeResendSend.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.clubId).toBeUndefined();
    expect(payload.clubSlug).toBeUndefined();
  });

  it('sends the text that was stored, not a re-rendered template', async () => {
    const { db } = fakeDb({
      scheduled: [row({ body: 'Hi Mary,\n\nThis exact sentence was approved.' })],
    });
    await sendDueScheduled(db, NOW);
    const payload = safeResendSend.mock.calls[0][1] as Record<string, unknown>;
    expect(String(payload.html)).toContain('This exact sentence was approved.');
  });

  /* ------------------------------------------------------ the important one */
  it('NEVER sends a row that was cancelled before the claim landed', async () => {
    const { db, store } = fakeDb({ cancelBeforeClaim: true });
    const report = await sendDueScheduled(db, NOW);

    expect(safeResendSend).not.toHaveBeenCalled();
    expect(report.sent).toBe(0);
    expect(report.skipped).toBe(1);
    expect(store.get('s1')!.status).toBe('cancelled');
  });

  it('never even considers a row that is already cancelled', async () => {
    const { db } = fakeDb({ scheduled: [row({ status: 'cancelled' })] });
    const report = await sendDueScheduled(db, NOW);
    expect(report.considered).toBe(0);
    expect(safeResendSend).not.toHaveBeenCalled();
  });

  // --------------------------------- Tuesday's approval, Thursday's permission
  it('refuses when the contact has been marked "don\'t contact" since', async () => {
    const { db, store } = fakeDb({ contact: { ...CONTACT, do_not_contact: true } });
    const report = await sendDueScheduled(db, NOW);
    expect(safeResendSend).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
    expect(store.get('s1')!.status).toBe('failed');
    expect(String(store.get('s1')!.detail)).toContain("don't contact");
  });

  it('refuses when the rep is no longer a CRM user', async () => {
    process.env.PLATFORM_OWNER_EMAILS = 'someone@else.test';
    const { db, store } = fakeDb({ rep: null });
    const report = await sendDueScheduled(db, NOW);
    expect(safeResendSend).not.toHaveBeenCalled();
    expect(report.failed).toBe(1);
    expect(String(store.get('s1')!.detail)).toContain('no longer a CRM user');
  });

  it('refuses when the address has changed under it', async () => {
    const { db, store } = fakeDb({ contact: { ...CONTACT, email: 'someone.else@example.test' } });
    await sendDueScheduled(db, NOW);
    expect(safeResendSend).not.toHaveBeenCalled();
    expect(String(store.get('s1')!.detail)).toContain('changed');
  });

  it('records a demo hold as failed, never as sent', async () => {
    safeResendSend.mockResolvedValue({ sent: true, messageId: 'demo-suppressed', demo: 'demo_club' });
    const { db, store } = fakeDb();
    const report = await sendDueScheduled(db, NOW);
    expect(report.sent).toBe(0);
    expect(report.failed).toBe(1);
    expect(store.get('s1')!.status).toBe('failed');
    expect(String(store.get('s1')!.detail)).toContain('NOT SENT');
  });

  it('records a Resend failure with its reason instead of dropping it', async () => {
    safeResendSend.mockResolvedValue({ sent: false, reason: 'error', error: 'domain not verified' });
    const { db, store } = fakeDb();
    await sendDueScheduled(db, NOW);
    expect(store.get('s1')!.status).toBe('failed');
    expect(String(store.get('s1')!.detail)).toContain('domain not verified');
  });
});

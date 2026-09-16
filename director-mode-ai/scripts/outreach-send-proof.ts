/**
 * Prove the send path against the REAL database, without mailing a real club.
 *
 *   npx vite-node -c vitest.config.ts scripts/outreach-send-proof.ts
 *
 * Four checks, in order:
 *
 *   1. A `planned` row is refused and Resend is never reached.
 *   2. An `approved` row to a .invalid fake sends — through the REAL
 *      safeResendSend, with only the final HTTP call stubbed — and lands a
 *      ledger row, an activity, and stage 'contacted'. `.invalid` is the RFC
 *      2606 reserved TLD, so there is no mailbox in the world to reach even
 *      if the stub were removed.
 *   3. An @example.com recipient is HELD by the demo guard, and that hold is
 *      reported as a refusal rather than a success. This is the trap that has
 *      already bitten once: safeResendSend returns `{sent:true}` for a hold.
 *   4. A send to darrinjco@gmail.com is REFUSED, because that address has been
 *      on the unsubscribe list since 2026-09-09. The refusal is the test: the
 *      blocklist has to be consulted before any cold mail, and this is the one
 *      address we can prove it with.
 *
 * Run scripts/outreach-fake-deck.mjs seed first, and `clean` after.
 */
import { readFileSync } from 'fs';

for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = line.indexOf('=');
  if (i < 1 || line.trimStart().startsWith('#')) continue;
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
}

const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
const { sendQueued, OUTREACH_FROM } = await import('../src/lib/outreach/send');
const { QUEUE_COLS } = await import('../src/lib/outreach/types');
type QueueRow = import('../src/lib/outreach/types').QueueRow;

const db = getSupabaseAdmin();
let failures = 0;
const ok = (label: string, pass: boolean, detail = '') => {
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

/** Stands in for Resend's HTTP call and records what it was handed. */
const calls: Record<string, unknown>[] = [];
const stub = {
  emails: {
    send: async (args: unknown) => {
      calls.push(args as Record<string, unknown>);
      return { data: { id: `re_stub_${calls.length}` } };
    },
  },
};

async function rowFor(slug: string): Promise<QueueRow> {
  const { data: org } = await db.from('crm_orgs').select('id').eq('slug', slug).maybeSingle();
  if (!org) throw new Error(`No fake org ${slug}. Run scripts/outreach-fake-deck.mjs seed.`);
  const { data } = await db
    .from('crm_outreach_queue')
    .select(QUEUE_COLS)
    .eq('org_id', (org as { id: string }).id)
    .maybeSingle();
  if (!data) throw new Error(`No queue row for ${slug}. Run scripts/outreach-fake-deck.mjs seed.`);
  return data as unknown as QueueRow;
}

console.log(`\nFrom: ${OUTREACH_FROM}\n`);

// ---------------------------------------------------- 1. planned is refused
console.log('1. a planned row');
{
  const row = await rowFor('zz-fake-outreach-1');
  const before = calls.length;
  const r = await sendQueued(db, row, { resend: stub });
  ok('refused', r.outcome === 'skipped', r.message);
  ok('Resend never reached', calls.length === before);
}

// -------------------------------------------------- 2. approved goes out
console.log('\n2. an approved row to a .invalid fake, Resend stubbed');
{
  const row = await rowFor('zz-fake-outreach-1');
  await db.from('crm_outreach_queue').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', row.id);
  const r = await sendQueued(db, { ...row, status: 'approved' }, { resend: stub });
  ok('sent', r.outcome === 'sent', r.message);

  const sentArgs = calls[calls.length - 1] ?? {};
  ok('from outreach.clubmode.ai', String(sentArgs.from).includes('outreach.clubmode.ai'), String(sentArgs.from));
  ok('not from mail.clubmode.ai', !String(sentArgs.from).includes('mail.clubmode.ai'));
  ok('reply-to is the rep', String(sentArgs.replyTo).includes('darrinjco@gmail.com'), String(sentArgs.replyTo));
  ok('postal address on it', String(sentArgs.html).includes(process.env.CRM_POSTAL_ADDRESS?.slice(0, 12) ?? 'Hillgrade'));
  ok('plain opt-out line on it', String(sentArgs.html).includes("Tell me to stop and I won't write again."));
  ok('signed unsubscribe footer on it', String(sentArgs.html).includes('/unsubscribe?token='));
  ok('no club scoping passed', !('clubId' in sentArgs) && !('clubSlug' in sentArgs));

  const { data: after } = await db.from('crm_outreach_queue').select('status, resend_id').eq('id', row.id).maybeSingle();
  ok('queue row is sent', (after as { status: string }).status === 'sent');
  const { count: ledger } = await db
    .from('crm_email_sends')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', row.org_id)
    .eq('status', 'sent');
  ok('ledger row written', (ledger ?? 0) === 1);
  const { count: acts } = await db
    .from('crm_activities')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', row.org_id);
  ok('activity written', (acts ?? 0) === 1);
  const { data: org } = await db.from('crm_orgs').select('stage').eq('id', row.org_id).maybeSingle();
  ok("stage moved to 'contacted'", (org as { stage: string }).stage === 'contacted');
}

// --------------------------------------------- 3. the demo guard, surfaced
console.log('\n3. an @example.com recipient — the demo guard must NOT read as a send');
{
  const row = await rowFor('zz-fake-outreach-3');
  await db.from('crm_outreach_queue').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', row.id);
  const before = calls.length;
  const r = await sendQueued(db, { ...row, status: 'approved' }, { resend: stub });
  ok('reported as held, not sent', r.outcome === 'held', r.message);
  ok('message says NOT SENT', r.message.includes('NOT SENT'));
  ok('Resend never reached', calls.length === before);
  const { data: after } = await db.from('crm_outreach_queue').select('status, detail').eq('id', row.id).maybeSingle();
  ok('queue row is failed, not sent', (after as { status: string }).status === 'failed', (after as { detail: string }).detail);
  const { count: acts } = await db
    .from('crm_activities')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', row.org_id);
  ok('no activity claims the club heard from us', (acts ?? 0) === 0);
}

// ------------------------------------- 4. the real address that must refuse
console.log('\n4. a REAL send to darrinjco@gmail.com (on the unsubscribe list since 2026-09-09)');
{
  const row = await rowFor('zz-fake-outreach-2');
  await db.from('crm_contacts').update({ email: 'darrinjco@gmail.com' }).eq('id', row.contact_id);
  await db.from('crm_outreach_queue').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', row.id);
  // NO stub. This is the real Resend client; the blocklist has to stop it
  // before the HTTP call, or an email actually leaves.
  const r = await sendQueued(db, { ...row, status: 'approved' });
  ok('refused as unsubscribed', r.outcome === 'blocked' && /unsubscrib/i.test(r.message), r.message);
  const { data: after } = await db.from('crm_outreach_queue').select('status, detail').eq('id', row.id).maybeSingle();
  ok('queue row not marked sent', (after as { status: string }).status === 'failed', (after as { detail: string }).detail);
}

console.log(`\n${failures === 0 ? 'All checks passed.' : `${failures} FAILED.`}`);
console.log('Run  node scripts/outreach-fake-deck.mjs clean  to remove every fake row.\n');
process.exit(failures === 0 ? 0 : 1);

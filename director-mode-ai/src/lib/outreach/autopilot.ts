/**
 * Outreach autopilot: six cold letters a weekday, no swipe.
 *
 *   lane 'dca'    3 a day from the Directors Club of America list
 *   lane 'found'  3 a day from clubs discoverClubs() finds on the web
 *
 * Each lane alternates letter A and letter B (see variants.ts) so the split
 * test stays balanced inside each lane. The one follow-up, eight days later,
 * comes out of the same lane's three and goes first.
 *
 * With settings.auto_send false (how it ships) cards are written `planned`
 * and wait in the deck. With it true they are written `approved`, and the
 * hourly sender (send.ts) sends them inside each club's 8-3 window with all
 * of its own checks: suppression, the 30-day rule, unsubscribes, the cap.
 * A reply suppresses the club (lib/crm/inbound.ts), which also cancels its
 * follow-up.
 */

import { Resend } from 'resend';
import type { getSupabaseAdmin } from '@/lib/supabase/admin';
import { daysBetween, type ISODate } from '@/lib/crm/dates';
import { loadCandidates, loadFollowUpSources, loadSettings, selectFollowUps, selectIntros, type Candidate } from './plan';
import { outreachToday } from './settings';
import { canBeSentC, newRef, nextVariant, renderLetter, VARIANT_LABEL, VARIANTS, type Links, type Variant } from './variants';
import { discoverClubs } from './discover';

type Db = ReturnType<typeof getSupabaseAdmin>;
export type Lane = 'dca' | 'found';
export const LANES: readonly Lane[] = ['dca', 'found'];
export const LANE_LABEL: Record<Lane, string> = { dca: 'Directors Club', found: 'Found on the web' };

export const DCA_SOURCE = 'Directors Club of America';
export const FOUND_SOURCE = 'discovered';

export interface AutopilotSettings {
  auto_send: boolean;
  paused: boolean;
  dca_per_day: number;
  found_per_day: number;
  links: Links;
  digest_emails: string[];
  /** Letter C (Benchmarks) is in the rotation. Off until Darrin approves it. */
  variant_c: boolean;
}

export async function loadAutopilot(db: Db): Promise<AutopilotSettings> {
  const { data } = await db
    .from('crm_outreach_settings')
    .select('auto_send, paused, dca_per_day, found_per_day, demo_url, mixer_url, digest_emails, variant_c')
    .eq('id', 1)
    .maybeSingle();
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    auto_send: r.auto_send === true,
    paused: r.paused === true,
    dca_per_day: Number(r.dca_per_day ?? 3),
    found_per_day: Number(r.found_per_day ?? 3),
    links: { demo_url: (r.demo_url as string) || null, mixer_url: (r.mixer_url as string) || null },
    digest_emails: Array.isArray(r.digest_emails) ? (r.digest_emails as string[]) : [],
    variant_c: r.variant_c === true,
  };
}

export function laneOfSource(source: string | null | undefined): Lane | null {
  if (source === DCA_SOURCE) return 'dca';
  if (source === FOUND_SOURCE) return 'found';
  return null;
}

export interface AutopilotCard {
  org_name: string;
  to: string;
  lane: Lane;
  variant: Variant;
  kind: 'intro' | 'followup';
  subject: string;
  body: string;
}

export interface AutopilotResult {
  date: ISODate;
  auto_send: boolean;
  planned: number;
  cards: AutopilotCard[];
  discovered: number;
  note?: string;
}

export async function planAutopilot(
  db: Db,
  opts: { repEmail: string; dryRun?: boolean; now?: Date; skipDiscovery?: boolean },
): Promise<AutopilotResult> {
  const now = opts.now ?? new Date();
  const today = outreachToday(now);
  const ap = await loadAutopilot(db);
  const base: AutopilotResult = { date: today, auto_send: ap.auto_send, planned: 0, cards: [], discovered: 0 };
  if (ap.paused) return { ...base, note: 'Outreach is paused. Nothing planned.' };
  if (!ap.links.demo_url) return { ...base, note: 'No demo_url in crm_outreach_settings. Nothing planned.' };

  const perLane: Record<Lane, number> = { dca: ap.dca_per_day, found: ap.found_per_day };

  // What today already holds, per lane, so a re-run tops up instead of doubling.
  const { data: todayRows } = await db
    .from('crm_outreach_queue')
    .select('lane')
    .eq('send_date', today)
    .in('status', ['planned', 'approved', 'sent']);
  const room: Record<Lane, number> = { ...perLane };
  for (const r of (todayRows as { lane: Lane | null }[] | null) ?? []) {
    const lane = r.lane ?? 'dca';
    room[lane] = Math.max(0, room[lane] - 1);
  }

  // Variant balance so far, per lane (intros only).
  const { data: sentRows } = await db
    .from('crm_outreach_queue')
    .select('lane, variant')
    .eq('kind', 'intro')
    .in('status', ['planned', 'approved', 'sent'])
    .not('variant', 'is', null);
  const balance: Record<Lane, Partial<Record<Variant, number>>> = { dca: {}, found: {} };
  for (const r of (sentRows as { lane: Lane | null; variant: Variant }[] | null) ?? []) {
    const b = balance[r.lane ?? 'dca'];
    b[r.variant] = (b[r.variant] ?? 0) + 1;
  }

  const { data: srcRows } = await db.from('crm_orgs').select('id, source').limit(10000);
  const laneOf = new Map(((srcRows as { id: string; source: string | null }[] | null) ?? []).map((o) => [o.id, laneOfSource(o.source)]));

  const status = ap.auto_send ? 'approved' : 'planned';
  const approvedAt = ap.auto_send ? now.toISOString() : null;
  const cards: AutopilotCard[] = [];
  let planned = 0;

  const write = async (row: Record<string, unknown>, card: AutopilotCard) => {
    cards.push(card);
    if (opts.dryRun) return;
    const { error } = await db.from('crm_outreach_queue').insert({
      ...row,
      rep_email: opts.repEmail,
      send_date: today,
      status,
      approved_at: approvedAt,
      generated_by: 'template',
      lane: card.lane,
      variant: card.variant,
    });
    if (!error) planned += 1;
    else if (error.code !== '23505') throw new Error(`autopilot insert failed: ${error.message}`);
  };

  // ---------------------------------------------------------- follow-ups
  let candidates = await loadCandidates(db);
  const { data: introMeta } = await db
    .from('crm_outreach_queue')
    .select('id, lane, variant')
    .eq('kind', 'intro')
    .eq('status', 'sent');
  const meta = new Map(((introMeta as { id: string; lane: Lane | null; variant: Variant | null }[] | null) ?? []).map((m) => [m.id, m]));

  const settings = await loadSettings(db);
  const due = selectFollowUps(await loadFollowUpSources(db), { cap: 50, today, followUpDays: settings.follow_up_days });
  for (const f of due) {
    const m = meta.get(f.queue.id);
    // Only letters the autopilot wrote get its follow-up; deck-era intros
    // carry their own copy and are left to the deck.
    if (!m?.variant) continue;
    const lane = m.lane ?? 'dca';
    if (room[lane] <= 0) continue;
    const { data: contact } = await db
      .from('crm_contacts')
      .select('id, full_name, email')
      .eq('id', f.queue.contact_id ?? '')
      .maybeSingle();
    const { data: org } = await db.from('crm_orgs').select('id, name').eq('id', f.queue.org_id).maybeSingle();
    const ct = contact as { id: string; full_name: string; email: string } | null;
    const o = org as { id: string; name: string } | null;
    if (!ct?.email || !o) continue;
    const ref = newRef();
    const letter = renderLetter('followup', m.variant, { club: o.name, fullName: ct.full_name }, ap.links, ref);
    if (!letter) continue;
    room[lane] -= 1;
    await write(
      {
        org_id: o.id, contact_id: ct.id, subject: letter.subject, body: letter.body, kind: 'followup',
        follow_up_of: f.queue.id, dedupe_key: `${o.id}:followup`, ref,
        why: `Follow-up, ${daysBetween((f.queue.sent_at ?? today).slice(0, 10), today)} days after letter ${m.variant}, no reply.`,
      },
      { org_name: o.name, to: ct.email, lane, variant: m.variant, kind: 'followup', ...letter },
    );
  }

  // ------------------------------------------------------ top up 'found'
  const eligibleIn = (lane: Lane, list: Candidate[]) =>
    selectIntros(list.filter((c) => laneOf.get(c.org_id) === lane), { cap: 100, today, repEmail: opts.repEmail }).picks.length;

  let discovered = 0;
  if (ap.auto_send && !opts.skipDiscovery && room.found > 0) {
    const short = room.found - eligibleIn('found', candidates);
    if (short > 0) {
      try {
        const got = await discoverClubs(db, { count: short, dryRun: opts.dryRun });
        discovered = got.added.length;
        if (discovered && !opts.dryRun) {
          candidates = await loadCandidates(db);
          const { data: fresh } = await db.from('crm_orgs').select('id, source').eq('source', FOUND_SOURCE);
          for (const o of (fresh as { id: string; source: string }[] | null) ?? []) laneOf.set(o.id, 'found');
        }
      } catch (e) {
        base.note = `Club search failed: ${(e as Error).message}`;
      }
    }
  }

  // --------------------------------------------------------------- intros
  for (const lane of LANES) {
    if (room[lane] <= 0) continue;
    const { picks } = selectIntros(
      candidates.filter((c) => laneOf.get(c.org_id) === lane),
      { cap: room[lane], today, repEmail: opts.repEmail },
    );
    for (const p of picks) {
      // C (Benchmarks) only for a racquet director at their own address.
      const allowed: Variant[] = ap.variant_c && canBeSentC({ title: p.contact.title, email: p.contact.email }, { knownDirector: lane === 'dca' }) ? ['A', 'B', 'C'] : ['A', 'B'];
      const variant = nextVariant(balance[lane], allowed);
      balance[lane][variant] = (balance[lane][variant] ?? 0) + 1;
      const ref = newRef();
      const letter = renderLetter('intro', variant, { club: p.candidate.org_name, fullName: p.contact.full_name }, ap.links, ref);
      if (!letter) continue;
      await write(
        {
          org_id: p.candidate.org_id, contact_id: p.contact.id, subject: letter.subject, body: letter.body,
          kind: 'intro', follow_up_of: null, dedupe_key: `${p.candidate.org_id}:intro`, ref,
          why: `${LANE_LABEL[lane]}, letter ${variant}.`,
        },
        { org_name: p.candidate.org_name, to: p.contact.email, lane, variant, kind: 'intro', ...letter },
      );
    }
  }

    return { ...base, planned, cards, discovered };
}

// ------------------------------------------------------------ scoreboard

export interface ScoreRow {
  lane: Lane | 'all';
  variant: Variant;
  sent: number;
  /** Clubs whose letter link was opened (demo_visits by ref). Link scanners can inflate this. */
  clicked: number;
  replied: number;
}

/**
 * Intros sent per lane and letter, and how many of those clubs wrote back
 * afterwards. A reply is any email filed on the club after the intro went out
 * (crm_inbound_emails), so a "no thanks" counts: the test is which letter
 * gets people to answer at all.
 */
export async function scoreboard(db: Db): Promise<ScoreRow[]> {
  const [{ data: sent }, { data: replies }, { data: visits }, { data: refs }] = await Promise.all([
    db.from('crm_outreach_queue').select('org_id, lane, variant, sent_at').eq('kind', 'intro').eq('status', 'sent').not('variant', 'is', null),
    db.from('crm_inbound_emails').select('org_id, received_at').not('org_id', 'is', null),
    db.from('demo_visits').select('ref').not('ref', 'is', null).limit(10000),
    db.from('crm_outreach_queue').select('org_id, ref').not('ref', 'is', null).limit(10000),
  ]);
  const clickedRefs = new Set(((visits as { ref: string }[] | null) ?? []).map((v) => v.ref));
  const clickedOrgs = new Set(
    ((refs as { org_id: string; ref: string }[] | null) ?? []).filter((q) => clickedRefs.has(q.ref)).map((q) => q.org_id),
  );
  const firstReply = new Map<string, string>();
  for (const r of (replies as { org_id: string; received_at: string }[] | null) ?? []) {
    const cur = firstReply.get(r.org_id);
    if (!cur || r.received_at < cur) firstReply.set(r.org_id, r.received_at);
  }
  const rows = new Map<string, ScoreRow>();
  const bump = (lane: Lane | 'all', variant: Variant, replied: boolean, clicked: boolean) => {
    const k = `${lane}:${variant}`;
    const row = rows.get(k) ?? { lane, variant, sent: 0, clicked: 0, replied: 0 };
    row.sent += 1;
    if (clicked) row.clicked += 1;
    if (replied) row.replied += 1;
    rows.set(k, row);
  };
  for (const s of (sent as { org_id: string; lane: Lane | null; variant: Variant; sent_at: string }[] | null) ?? []) {
    const r = firstReply.get(s.org_id);
    const replied = !!r && r >= s.sent_at;
    const clicked = clickedOrgs.has(s.org_id);
    bump(s.lane ?? 'dca', s.variant, replied, clicked);
    bump('all', s.variant, replied, clicked);
  }
  const out: ScoreRow[] = [];
  for (const lane of ['all', ...LANES] as const) {
    for (const v of VARIANTS) out.push(rows.get(`${lane}:${v}`) ?? { lane, variant: v, sent: 0, clicked: 0, replied: 0 });
  }
  return out;
}

// ---------------------------------------------------------------- digest

const pct = (r: ScoreRow) => (r.sent ? `${Math.round((100 * r.replied) / r.sent)}%` : '-');

/**
 * The morning email to Darrin and Kevin: what went out yesterday, who wrote
 * back, the A/B score, and exactly what goes out today.
 */
export async function sendDigest(db: Db, plan: AutopilotResult, now = new Date()): Promise<{ sent: boolean; error?: string }> {
  const ap = await loadAutopilot(db);
  if (!ap.digest_emails.length) return { sent: false, error: 'no digest_emails' };
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString();

  const [{ data: out }, { data: inb }, score] = await Promise.all([
    db.from('crm_outreach_queue').select('subject, lane, variant, kind, sent_at, crm_orgs(name), crm_contacts(full_name, email)').eq('status', 'sent').gte('sent_at', since).order('sent_at'),
    db.from('crm_inbound_emails').select('from_name, from_email, body, received_at, crm_orgs(name)').gte('received_at', since).order('received_at'),
    scoreboard(db),
  ]);
  type Joined = { name?: string } | { name?: string }[] | null;
  const nm = (j: Joined) => (Array.isArray(j) ? j[0]?.name : j?.name) ?? '?';

  const lines: string[] = [];
  lines.push(ap.auto_send ? 'Autopilot is ON.' : 'Autopilot is OFF (letters wait in the deck until it is switched on).');
  lines.push('', 'REPLIES IN THE LAST 24 HOURS');
  const replies = (inb as { from_name: string | null; from_email: string; body: string; crm_orgs: Joined }[] | null) ?? [];
  if (!replies.length) lines.push('None.');
  for (const r of replies) lines.push(`- ${r.from_name || r.from_email} (${nm(r.crm_orgs)}): ${r.body.replace(/\s+/g, ' ').slice(0, 200)}`);

  lines.push('', 'SENT IN THE LAST 24 HOURS');
  const sentRows = (out as { subject: string; lane: Lane | null; variant: Variant | null; kind: string; crm_orgs: Joined; crm_contacts: { full_name?: string; email?: string } | null }[] | null) ?? [];
  if (!sentRows.length) lines.push('None.');
  for (const s of sentRows) {
    lines.push(`- ${nm(s.crm_orgs)}, ${s.crm_contacts?.full_name ?? ''} <${s.crm_contacts?.email ?? ''}>: ${s.kind === 'followup' ? 'follow-up' : `letter ${s.variant ?? '?'}`} (${LANE_LABEL[s.lane ?? 'dca']})`);
  }

  lines.push('', 'SPLIT TEST SO FAR (first letters sent, clubs that opened the link, clubs that replied)');
  for (const r of score.filter((x) => x.lane === 'all')) lines.push(`- ${VARIANT_LABEL[r.variant]}: ${r.sent} sent, ${r.clicked} opened the link, ${r.replied} replied (${pct(r)})`);
  for (const lane of LANES) {
    const rows = score.filter((x) => x.lane === lane).map((x) => `${x.variant} ${x.sent} sent / ${x.clicked} opened / ${x.replied} replied`);
    lines.push(`  ${LANE_LABEL[lane]}: ${rows.join(', ')}`);
  }
  lines.push('  Letter C (Benchmarks) goes only to racquet directors and head pros at their own address.');

  lines.push('', `GOING OUT TODAY (${plan.cards.length})`);
  if (plan.note) lines.push(plan.note);
  if (plan.discovered) lines.push(`Found ${plan.discovered} new club${plan.discovered === 1 ? '' : 's'} on the web this morning.`);
  for (const c of plan.cards) lines.push(`- ${c.org_name} <${c.to}>: ${c.kind === 'followup' ? 'follow-up' : `letter ${c.variant}`} (${LANE_LABEL[c.lane]})`);

  lines.push('', 'Every letter and the on/off switch: https://clubmode.ai/crm/autopilot');

  const text = lines.join('\n');
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const r = await resend.emails.send({
      from: 'ClubMode Autopilot <sales@mail.clubmode.ai>',
      to: ap.digest_emails,
      subject: `Outreach: ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}, ${sentRows.length} sent, ${plan.cards.length} today`,
      text,
    });
    if ((r as { error?: { message?: string } }).error) return { sent: false, error: (r as { error: { message?: string } }).error.message };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

import { getSupabaseAdmin } from '@/lib/supabase/admin';

// ---- Sleepy Hollow Summer Flex League — shared state + email model ----
// DB-driven (no hardcoded rosters/contacts): reads events / tournament_entries
// / tournament_matches for the 4 flex divisions and derives per-player progress
// so the /flex/admin board and the update + nudge emails always reflect reality.

export const MATCHES_PER_PLAYER = 4;

export const FLEX_DIVISIONS = [
  { id: 'mens-singles', slug: 'mens-singles-flex-2026', name: "Men's Singles" },
  { id: 'womens-singles', slug: 'womens-singles-flex-2026', name: "Women's Singles" },
  { id: 'mens-doubles', slug: 'mens-doubles-flex-2026', name: "Men's Doubles" },
  { id: 'womens-doubles', slug: 'womens-doubles-flex-2026', name: "Women's Doubles" },
] as const;

export const FLEX_ROUNDS = [
  { n: 1, label: 'Round 1', start: '2026-06-22', end: '2026-07-09' },
  { n: 2, label: 'Round 2', start: '2026-07-10', end: '2026-07-26' },
  { n: 3, label: 'Round 3', start: '2026-07-27', end: '2026-08-16' },
  { n: 4, label: 'Round 4', start: '2026-08-17', end: '2026-08-30' },
] as const;

const ANCHOR: Record<string, string> = {
  'mens-singles-flex-2026': 'mens-singles',
  'womens-singles-flex-2026': 'womens-singles',
  'mens-doubles-flex-2026': 'mens-doubles',
  'womens-doubles-flex-2026': 'womens-doubles',
};

export const FLEX_URL = 'https://club.coachmode.ai/flex';
export const FLEX_FROM = 'Sleepy Hollow Swim & Tennis Club <noreply@mail.coachmode.ai>';
export const FLEX_REPLY_TO = 'darrinjco@gmail.com';

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

/** The round whose window contains `today`, else the next upcoming, else the last. */
export function currentRound(today = new Date()) {
  const t = today.toISOString().slice(0, 10);
  return (
    FLEX_ROUNDS.find((r) => t >= r.start && t <= r.end) ||
    FLEX_ROUNDS.find((r) => t < r.start) ||
    FLEX_ROUNDS[FLEX_ROUNDS.length - 1]
  );
}

type Entry = {
  id: string;
  name: string; // display label (doubles = "A / B")
  playerName: string;
  playerEmail: string | null;
  playerPhone: string | null;
  partnerName: string | null;
  partnerEmail: string | null;
  partnerPhone: string | null;
  completed: number;
};

type RawMatch = {
  id: string;
  round: number | null;
  bracket: string | null;
  status: string;
  a: string | null; // player1_id
  b: string | null; // player3_id
};

export type DivisionState = {
  id: string;
  slug: string;
  name: string;
  anchor: string;
  entries: Entry[];
  matchesTotal: number;
  matchesCompleted: number;
  playablePending: number; // both sides known, not yet played
  behind: { name: string; played: number; outstanding: number }[]; // players with playable matches left
};

export type FlexState = {
  divisions: DivisionState[];
  totalPlayers: number;
  totalMatchesCompleted: number;
  totalPlayablePending: number;
};

const firstNameOf = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there';
const contactBits = (email: string | null, phone: string | null) =>
  [email, phone].filter(Boolean).join(' · ');

async function loadDivision(slug: string) {
  const admin = getSupabaseAdmin();
  const { data: ev } = await admin.from('events').select('id').eq('slug', slug).maybeSingle();
  if (!ev) return null;
  const eid = (ev as { id: string }).id;

  const { data: entryRows } = await admin
    .from('tournament_entries')
    .select('id, player_name, player_email, player_phone, partner_name, partner_email, partner_phone')
    .eq('event_id', eid);

  const { data: matchRows } = await admin
    .from('tournament_matches')
    .select('id, round, bracket, status, player1_id, player3_id')
    .eq('event_id', eid);

  const entries = new Map<string, Entry>();
  for (const r of (entryRows as Array<Record<string, unknown>>) || []) {
    const playerName = (r.player_name as string) || 'TBD';
    const partnerName = (r.partner_name as string) || null;
    entries.set(r.id as string, {
      id: r.id as string,
      name: partnerName ? `${playerName} / ${partnerName}` : playerName,
      playerName,
      playerEmail: (r.player_email as string) || null,
      playerPhone: (r.player_phone as string) || null,
      partnerName,
      partnerEmail: (r.partner_email as string) || null,
      partnerPhone: (r.partner_phone as string) || null,
      completed: 0,
    });
  }

  const matches: RawMatch[] = ((matchRows as Array<Record<string, unknown>>) || []).map((m) => ({
    id: m.id as string,
    round: (m.round as number) ?? null,
    bracket: (m.bracket as string) ?? null,
    status: m.status as string,
    a: (m.player1_id as string) || null,
    b: (m.player3_id as string) || null,
  }));

  for (const m of matches) {
    if (m.status !== 'completed') continue;
    if (m.a && entries.has(m.a)) entries.get(m.a)!.completed++;
    if (m.b && entries.has(m.b)) entries.get(m.b)!.completed++;
  }

  return { eid, entries, matches };
}

export async function getFlexState(): Promise<FlexState> {
  const divisions: DivisionState[] = [];
  const emails = new Set<string>();
  let totalMatchesCompleted = 0;
  let totalPlayablePending = 0;

  for (const cfg of FLEX_DIVISIONS) {
    const loaded = await loadDivision(cfg.slug);
    if (!loaded) continue;
    const { entries, matches } = loaded;

    const playable = matches.filter((m) => m.status === 'pending' && m.a && m.b);
    const outstandingByEntry = new Map<string, number>();
    for (const m of playable) {
      outstandingByEntry.set(m.a!, (outstandingByEntry.get(m.a!) || 0) + 1);
      outstandingByEntry.set(m.b!, (outstandingByEntry.get(m.b!) || 0) + 1);
    }

    const behind = [...entries.values()]
      .map((e) => ({ name: e.name, played: e.completed, outstanding: outstandingByEntry.get(e.id) || 0 }))
      .filter((x) => x.outstanding > 0)
      .sort((a, b) => a.played - b.played || b.outstanding - a.outstanding);

    const matchesCompleted = matches.filter((m) => m.status === 'completed').length;
    totalMatchesCompleted += matchesCompleted;
    totalPlayablePending += playable.length;
    for (const e of entries.values()) {
      if (e.playerEmail) emails.add(e.playerEmail.toLowerCase());
      if (e.partnerEmail) emails.add(e.partnerEmail.toLowerCase());
    }

    divisions.push({
      id: cfg.id,
      slug: cfg.slug,
      name: cfg.name,
      anchor: ANCHOR[cfg.slug],
      entries: [...entries.values()],
      matchesTotal: matches.length,
      matchesCompleted,
      playablePending: playable.length,
      behind,
    });
  }

  return {
    divisions,
    totalPlayers: emails.size,
    totalMatchesCompleted,
    totalPlayablePending,
  };
}

// ---- Recipient model for the two emails ----

export type NudgeItem = { divisionName: string; opponent: string; contact: string };
export type NudgeRecipient = {
  email: string;
  firstName: string;
  divisions: { name: string; played: number; outstanding: NudgeItem[] }[];
  outstandingTotal: number;
};

/** One personalized nudge per person-email, only for players who still owe playable matches. */
export async function buildNudgeRecipients(): Promise<NudgeRecipient[]> {
  const byEmail = new Map<string, NudgeRecipient>();

  for (const cfg of FLEX_DIVISIONS) {
    const loaded = await loadDivision(cfg.slug);
    if (!loaded) continue;
    const { entries, matches } = loaded;
    const playable = matches.filter((m) => m.status === 'pending' && m.a && m.b);

    // outstanding matches per entry, with the opposing entry as opponent
    const perEntry = new Map<string, { opponent: string; contact: string }[]>();
    for (const m of playable) {
      const A = entries.get(m.a!);
      const B = entries.get(m.b!);
      if (!A || !B) continue;
      const oppContactB = [
        contactBits(B.playerEmail, B.playerPhone),
        B.partnerName ? contactBits(B.partnerEmail, B.partnerPhone) : '',
      ].filter(Boolean).join('  |  ');
      const oppContactA = [
        contactBits(A.playerEmail, A.playerPhone),
        A.partnerName ? contactBits(A.partnerEmail, A.partnerPhone) : '',
      ].filter(Boolean).join('  |  ');
      (perEntry.get(m.a!) || perEntry.set(m.a!, []).get(m.a!)!).push({ opponent: B.name, contact: oppContactB });
      (perEntry.get(m.b!) || perEntry.set(m.b!, []).get(m.b!)!).push({ opponent: A.name, contact: oppContactA });
    }

    for (const e of entries.values()) {
      const outstanding = perEntry.get(e.id);
      if (!outstanding || outstanding.length === 0) continue;
      // notify both the player and (for doubles) the partner
      const people = [
        { email: e.playerEmail, name: e.playerName },
        ...(e.partnerEmail ? [{ email: e.partnerEmail, name: e.partnerName || '' }] : []),
      ].filter((p) => p.email);

      for (const p of people) {
        const key = p.email!.toLowerCase();
        let rec = byEmail.get(key);
        if (!rec) {
          rec = { email: p.email!, firstName: firstNameOf(p.name), divisions: [], outstandingTotal: 0 };
          byEmail.set(key, rec);
        }
        rec.divisions.push({
          name: cfg.name,
          played: e.completed,
          outstanding: outstanding.map((o) => ({ divisionName: cfg.name, opponent: o.opponent, contact: o.contact })),
        });
        rec.outstandingTotal += outstanding.length;
      }
    }
  }

  return [...byEmail.values()].sort((a, b) => b.outstandingTotal - a.outstandingTotal);
}

/** All unique player emails across the four divisions (for the broadcast update). */
export async function buildUpdateRecipients(): Promise<{ email: string; firstName: string }[]> {
  const byEmail = new Map<string, { email: string; firstName: string }>();
  for (const cfg of FLEX_DIVISIONS) {
    const loaded = await loadDivision(cfg.slug);
    if (!loaded) continue;
    for (const e of loaded.entries.values()) {
      if (e.playerEmail && !byEmail.has(e.playerEmail.toLowerCase()))
        byEmail.set(e.playerEmail.toLowerCase(), { email: e.playerEmail, firstName: firstNameOf(e.playerName) });
      if (e.partnerEmail && !byEmail.has(e.partnerEmail.toLowerCase()))
        byEmail.set(e.partnerEmail.toLowerCase(), { email: e.partnerEmail, firstName: firstNameOf(e.partnerName || '') });
    }
  }
  return [...byEmail.values()];
}

// ---- Email HTML ----

const shell = (inner: string) => `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:640px;margin:0 auto">
  <div style="background:linear-gradient(160deg,#1F4FA0,#163670);border-radius:14px 14px 0 0;padding:22px 26px;color:#fff">
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#FFD24F;font-weight:700">Sleepy Hollow · Summer 2026</div>
    <div style="font-size:26px;font-weight:800;text-transform:uppercase;margin-top:4px;letter-spacing:.01em">Summer Flex League</div>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 14px 14px;padding:22px 26px">${inner}</div>
</div>`;

const flexButton = (href: string, label: string) =>
  `<p style="margin:16px 0"><a href="${href}" style="display:inline-block;background:#16a34a;color:#fff;font-weight:700;text-decoration:none;padding:13px 24px;border-radius:9px;font-size:16px">${label}</a></p>`;

export function updateEmailHtml(firstName: string, state: FlexState): { subject: string; html: string } {
  const round = currentRound();
  const divLines = state.divisions
    .map(
      (d) =>
        `<tr><td style="padding:6px 14px 6px 0;font-weight:700;white-space:nowrap">${d.name}</td><td style="padding:6px 0;color:#374151">${d.matchesCompleted} of ${d.matchesTotal} matches played</td></tr>`
    )
    .join('');
  const inner = `<p>Hi ${firstName} —</p>
    <p>We're into the thick of the <strong>Summer Flex League</strong> and it's been a blast watching results roll in. Quick mid-summer check-in:</p>
    <p style="background:#eff4fc;border:1px solid #cfe0fc;border-radius:10px;padding:12px 16px;margin:14px 0">
      🎾 <strong>${state.totalMatchesCompleted} matches</strong> played across the league so far — and standings on every division are updating live as scores come in.</p>
    <table style="border-collapse:collapse;margin:6px 0 4px">${divLines}</table>
    <p style="margin-top:16px">We're currently in <strong>${round.label}</strong> (through ${fmtDate(round.end)}). A friendly reminder: <strong>you don't have to wait for a round window to open</strong> — if your next opponent is free, go ahead and play early. The sooner matches get in, the better everyone's schedule flows.</p>
    ${flexButton(FLEX_URL, '🎾 View live standings & enter scores')}
    <p style="font-size:13px;color:#6b7280">The live page has your division, your group, standings, and one-tap score entry — all in one spot: <a href="${FLEX_URL}" style="color:#1F4FA0">club.coachmode.ai/flex</a></p>
    <p>Thanks for making this such a fun league. Questions or a problem with your matchup? Just reply to this email. See you on the courts!</p>
    <p style="margin:2px 0 0">— Darrin</p>`;
  return { subject: 'Summer Flex League — Mid-Summer Update 🎾', html: shell(inner) };
}

export function nudgeEmailHtml(rec: NudgeRecipient, state: FlexState): { subject: string; html: string } {
  const round = currentRound();
  // merge division blocks by name (a person is usually one entry per division)
  const byDiv = new Map<string, { played: number; items: NudgeItem[] }>();
  for (const d of rec.divisions) {
    const cur = byDiv.get(d.name) || { played: d.played, items: [] };
    cur.played = Math.max(cur.played, d.played);
    for (const it of d.outstanding) cur.items.push(it);
    byDiv.set(d.name, cur);
  }
  const blocks = [...byDiv.entries()]
    .map(([name, info]) => {
      const rows = info.items
        .map(
          (it) => `<div style="margin:7px 0;padding:10px 14px;background:#f6f8fb;border:1px solid #e5e7eb;border-radius:8px">
            <div style="font-weight:700">vs ${it.opponent}</div>
            <div style="font-size:13px;color:#374151;margin-top:3px">Reach out: ${it.contact || '<em>contact on the live page</em>'}</div></div>`
        )
        .join('');
      return `<h3 style="font-size:16px;margin:18px 0 6px;color:#0f172a">${name} <span style="font-weight:600;color:#6b7280;font-size:14px">— you've played ${info.played} of ${MATCHES_PER_PLAYER}</span></h3>${rows}`;
    })
    .join('');

  const n = rec.outstandingTotal;
  const inner = `<p>Hi ${rec.firstName} —</p>
    <p>Just a gentle nudge to keep the <strong>Summer Flex League</strong> on track! You've got <strong>${n} match${n === 1 ? '' : 'es'}</strong> ready to play that ${n === 1 ? "hasn't" : "haven't"} been scheduled yet. We're in <strong>${round.label}</strong> (through ${fmtDate(round.end)}) — please reach out to your opponent${n === 1 ? '' : 's'} and find a time that works.</p>
    ${blocks}
    <p style="margin-top:16px;font-size:14px;color:#374151">💡 You can play any of these <strong>right now</strong> — no need to wait for the window. Once your score is in, standings update instantly.</p>
    ${flexButton(FLEX_URL, '🎾 Enter your scores & view standings')}
    <p style="font-size:13px;color:#6b7280">Already played and just need to log it? Enter it on the <a href="${FLEX_URL}" style="color:#1F4FA0">live page</a>. Something off with a matchup? Just reply. Thanks!</p>
    <p style="margin:2px 0 0">— Darrin</p>`;
  return { subject: 'Quick nudge — get your Flex League matches scheduled 🎾', html: shell(inner) };
}

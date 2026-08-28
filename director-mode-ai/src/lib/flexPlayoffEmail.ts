import { getSupabaseAdmin } from '@/lib/supabase/admin';
import {
  FLEX_CONFIG, allPairs, groupStandings, isGroupComplete, pairKey, placementLabel,
} from '@/lib/flexDivisions';
import { FLEX_URL, flexButton, shell } from '@/lib/flexLeague';

import { APP_HOST } from '@/lib/appUrl';
// ---- "Playoffs are set" announcement ----
//
// Fully DB-driven off the auto-generated placement matches, so this email is
// re-sendable: run it again after the Championship flights finish and it will
// announce THOSE playoffs (and any new champion) without a code change.

export type PlayoffMatchInfo = {
  divisionName: string;
  playoffTitle: string;
  label: string;
  a: string;
  b: string;
  aContact: string;
  bContact: string;
  status: string;
  score: string;
  winnerName: string | null;
};

export type DivisionSnapshot = {
  name: string;
  playoffs: { title: string; matches: PlayoffMatchInfo[] }[];
  champions: { crownTitle: string; name: string; detail: string }[];
  awaiting: { title: string; remaining: number }[];
};

export type PlayoffSnapshot = {
  divisions: DivisionSnapshot[];
  totalPlayoffMatches: number;
};

/** A playoff match seen from one player's side — opponent already resolved. */
export type MyPlayoffMatch = {
  info: PlayoffMatchInfo;
  opponent: string;
  opponentContact: string;
};

export type PlayoffRecipient = {
  email: string;
  firstName: string;
  mine: MyPlayoffMatch[];
};

const firstNameOf = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there';
const contactBits = (email: string | null, phone: string | null) =>
  [email, phone].filter(Boolean).join(' · ');

type LoadedEntry = {
  id: string;
  label: string;
  people: { name: string; email: string | null; phone: string | null }[];
};

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
    .select('round, slot, player1_id, player3_id, score, winner_side, status')
    .eq('event_id', eid)
    .eq('bracket', 'main');

  const entries = new Map<string, LoadedEntry>();
  for (const r of (entryRows as Array<Record<string, unknown>>) || []) {
    const playerName = (r.player_name as string) || 'TBD';
    const partnerName = (r.partner_name as string) || null;
    entries.set(r.id as string, {
      id: r.id as string,
      label: partnerName ? `${playerName} / ${partnerName}` : playerName,
      people: [
        { name: playerName, email: (r.player_email as string) || null, phone: (r.player_phone as string) || null },
        ...(partnerName
          ? [{ name: partnerName, email: (r.partner_email as string) || null, phone: (r.partner_phone as string) || null }]
          : []),
      ],
    });
  }

  const matches = ((matchRows as Array<Record<string, unknown>>) || []).map((m) => ({
    round: m.round as number,
    slot: m.slot as number,
    aId: (m.player1_id as string) || null,
    bId: (m.player3_id as string) || null,
    a: entries.get(m.player1_id as string)?.label || 'TBD',
    b: entries.get(m.player3_id as string)?.label || 'TBD',
    score: (m.score as string) || '',
    winner_side: (m.winner_side as 'a' | 'b' | null) || null,
    status: m.status as string,
  }));

  return { entries, matches };
}

const contactFor = (e: LoadedEntry | undefined) =>
  e ? e.people.map((p) => `${p.name} — ${contactBits(p.email, p.phone) || 'contact on the live page'}`).join('  |  ') : '';

/** Everything the announcement needs, derived entirely from live results. */
export async function buildPlayoffSnapshot(): Promise<{
  snapshot: PlayoffSnapshot;
  /** entry id -> that entry's playoff matches, with its own side resolved. */
  byEntry: Map<string, MyPlayoffMatch[]>;
  entriesById: Map<string, LoadedEntry>;
}> {
  const divisions: DivisionSnapshot[] = [];
  const byEntry = new Map<string, MyPlayoffMatch[]>();
  const entriesById = new Map<string, LoadedEntry>();
  let totalPlayoffMatches = 0;

  for (const cfg of FLEX_CONFIG) {
    const loaded = await loadDivision(cfg.slug);
    if (!loaded) continue;
    const { entries, matches } = loaded;
    for (const [id, e] of entries) entriesById.set(id, e);

    const byPair = new Map(matches.map((m) => [pairKey(m.a, m.b), m] as const));
    const matchesOf = (members: string[]) =>
      allPairs(members)
        .map(([a, b]) => byPair.get(pairKey(a, b)))
        .filter((m): m is NonNullable<typeof m> => !!m);

    const playoffs: DivisionSnapshot['playoffs'] = [];
    const champions: DivisionSnapshot['champions'] = [];
    const awaiting: DivisionSnapshot['awaiting'] = [];

    for (const po of cfg.playoffs || []) {
      const rows = matches.filter((m) => m.round === po.round).sort((x, y) => x.slot - y.slot);
      if (rows.length === 0) {
        // Playoff not generated yet — report what it's waiting on.
        for (const title of po.from) {
          const members = cfg.groups?.[title] || [];
          const played = matchesOf(members).filter((m) => m.status === 'completed').length;
          const remaining = allPairs(members).length - played;
          if (remaining > 0) awaiting.push({ title, remaining });
        }
        continue;
      }

      const infos: PlayoffMatchInfo[] = rows.map((m) => {
        const info: PlayoffMatchInfo = {
          divisionName: cfg.name,
          playoffTitle: po.title,
          label: placementLabel(m.slot, po.crownTitle),
          a: m.a,
          b: m.b,
          aContact: contactFor(entries.get(m.aId || '')),
          bContact: contactFor(entries.get(m.bId || '')),
          status: m.status,
          score: m.score,
          winnerName: m.status === 'completed' && m.winner_side ? (m.winner_side === 'a' ? m.a : m.b) : null,
        };
        // Resolve each side's opponent HERE, where the entry ids are known —
        // never by string-matching an address against a contact blob.
        if (m.aId) byEntry.set(m.aId, [...(byEntry.get(m.aId) || []), { info, opponent: info.b, opponentContact: info.bContact }]);
        if (m.bId) byEntry.set(m.bId, [...(byEntry.get(m.bId) || []), { info, opponent: info.a, opponentContact: info.aContact }]);
        return info;
      });

      playoffs.push({ title: po.title, matches: infos });
      totalPlayoffMatches += infos.filter((i) => i.status !== 'completed').length;

      const final = infos[0];
      if (final?.winnerName) {
        champions.push({
          crownTitle: po.crownTitle,
          name: final.winnerName,
          detail: `def. ${final.winnerName === final.a ? final.b : final.a} ${final.score}`,
        });
      }
      // Half-seeded bracket: say which flight is still deciding its side.
      for (const title of po.from) {
        const members = cfg.groups?.[title] || [];
        if (members.length && !isGroupComplete(members, matchesOf(members))) {
          const remaining = allPairs(members).length - matchesOf(members).filter((m) => m.status === 'completed').length;
          awaiting.push({ title, remaining });
        }
      }
    }

    // Single-flight divisions are decided by the round robin itself.
    if (!cfg.playoffs?.length && cfg.groups && Object.keys(cfg.groups).length === 1 && cfg.crownTitle) {
      const [title, members] = Object.entries(cfg.groups)[0];
      const ms = matchesOf(members);
      if (isGroupComplete(members, ms)) {
        const s = groupStandings(members, ms)[0];
        champions.push({
          crownTitle: cfg.crownTitle,
          name: s.name,
          detail: `${s.w}–${s.l}${s.l === 0 ? ', undefeated' : ''} in the ${title.toLowerCase()}`,
        });
      }
    }

    if (playoffs.length || champions.length || awaiting.length) {
      divisions.push({ name: cfg.name, playoffs, champions, awaiting });
    }
  }

  return { snapshot: { divisions, totalPlayoffMatches }, byEntry, entriesById };
}

/**
 * Everyone in the league gets the announcement; players who are IN a playoff
 * match also get their own matchup + opponent contact details at the top.
 */
export async function buildPlayoffRecipients(): Promise<{
  recipients: PlayoffRecipient[];
  snapshot: PlayoffSnapshot;
}> {
  const { snapshot, byEntry, entriesById } = await buildPlayoffSnapshot();
  const byEmail = new Map<string, PlayoffRecipient>();

  for (const [entryId, entry] of entriesById) {
    const mine = byEntry.get(entryId) || [];
    for (const p of entry.people) {
      if (!p.email) continue;
      const key = p.email.toLowerCase();
      const rec = byEmail.get(key) || { email: p.email, firstName: firstNameOf(p.name), mine: [] };
      for (const m of mine) if (!rec.mine.includes(m)) rec.mine.push(m);
      byEmail.set(key, rec);
    }
  }

  // Players with a playoff match first, so the preview + test sample shows the
  // personalized version rather than the plain announcement.
  const recipients = [...byEmail.values()].sort((a, b) => b.mine.length - a.mine.length);
  return { recipients, snapshot };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function playoffEmailHtml(rec: PlayoffRecipient, snap: PlayoffSnapshot): { subject: string; html: string } {
  const upcoming = rec.mine.filter((m) => m.info.status !== 'completed');

  const mineBlock = upcoming.length
    ? `<div style="background:#FFF8E6;border:1px solid #FFD98A;border-radius:12px;padding:16px 18px;margin:16px 0">
        <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:#B45309">Your playoff match${upcoming.length > 1 ? 'es' : ''}</div>
        ${upcoming
          .map(
            (m) => `<div style="margin-top:10px">
              <div style="font-size:12px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:.06em">${esc(m.info.divisionName)} · ${esc(m.info.label)}</div>
              <div style="font-size:19px;font-weight:800;color:#111827;margin-top:2px">vs ${esc(m.opponent)}</div>
              <div style="font-size:13.5px;color:#374151;margin-top:3px">Reach out: ${esc(m.opponentContact) || 'contact on the live page'}</div>
            </div>`
          )
          .join('')}
        <div style="font-size:13.5px;color:#78350f;margin-top:12px">Please connect with your opponent and get this on the calendar. Winner takes the placement.</div>
      </div>`
    : '';

  const championBlocks = snap.divisions
    .flatMap((d) => d.champions.map((c) => ({ ...c, division: d.name })))
    .map(
      (c) => `<div style="background:linear-gradient(135deg,#1F4FA0,#0B1428);border-radius:12px;padding:15px 18px;margin:10px 0;color:#fff">
        <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;font-weight:700;color:#FFD24F">🏆 ${esc(c.crownTitle)}</div>
        <div style="font-size:23px;font-weight:800;margin-top:3px;line-height:1.15">${esc(c.name)}</div>
        <div style="font-size:13.5px;color:rgba(255,255,255,.82);margin-top:3px">${esc(c.detail)}</div>
      </div>`
    )
    .join('');

  const boardBlocks = snap.divisions
    .filter((d) => d.playoffs.length)
    .map((d) => {
      const inner = d.playoffs
        .map(
          (p) => `<div style="margin-top:10px">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#1F4FA0">${esc(p.title)}</div>
            <table style="border-collapse:collapse;width:100%;margin-top:5px">
              ${p.matches
                .map(
                  (m) => `<tr>
                    <td style="padding:5px 10px 5px 0;font-size:12.5px;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(m.label.replace(/^.*— /, ''))}</td>
                    <td style="padding:5px 0;font-size:14.5px;color:#111827">${
                      m.winnerName
                        ? `<strong style="color:#15803d">${esc(m.winnerName)}</strong> def. ${esc(m.winnerName === m.a ? m.b : m.a)} ${esc(m.score)}`
                        : `<strong>${esc(m.a)}</strong> vs <strong>${esc(m.b)}</strong>`
                    }</td>
                  </tr>`
                )
                .join('')}
            </table>
          </div>`
        )
        .join('');
      return `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:13px 16px;margin:12px 0">
        <div style="font-size:17px;font-weight:800;color:#0f172a">${esc(d.name)}</div>${inner}</div>`;
    })
    .join('');

  const awaiting = snap.divisions.flatMap((d) => d.awaiting.map((a) => `${d.name} — ${a.title} (${a.remaining} left)`));
  const awaitingBlock = awaiting.length
    ? `<p style="font-size:14px;color:#374151;background:#F1F5F9;border-radius:10px;padding:11px 15px">
        <strong>Still to come:</strong> these flights need to finish before their playoff can be seeded —
        ${awaiting.map(esc).join('; ')}. As soon as the last result is in, the matchups appear automatically.</p>`
    : '';

  const inner = `<p>Hi ${esc(rec.firstName)} —</p>
    <p><strong>The playoffs are set!</strong> Every flight that has finished its round robin now has its crossover matchups posted on the live page — seeded automatically off the final flight standings, so the top finisher in one flight plays the top finisher in the other, second plays second, and so on.</p>
    ${mineBlock}
    ${championBlocks ? `<h3 style="font-size:16px;margin:20px 0 4px;color:#0f172a">Champions crowned</h3>${championBlocks}` : ''}
    ${boardBlocks ? `<h3 style="font-size:16px;margin:20px 0 2px;color:#0f172a">The playoff board</h3>${boardBlocks}` : ''}
    ${awaitingBlock}
    ${flexButton(FLEX_URL, '🏆 See the playoff board & enter scores')}
    <p style="font-size:13px;color:#6b7280">Everything is live at <a href="${FLEX_URL}" style="color:#1F4FA0">${APP_HOST}/flex</a> — your matchup, contact info for your opponent, and one-tap score entry. Standings and the bracket update the moment a score goes in.</p>
    <p>Thanks for a great season — let's finish it off. Questions or a problem with your matchup? Just reply to this email.</p>
    <p style="margin:2px 0 0">— Darrin</p>`;

  return {
    subject: upcoming.length
      ? '🏆 Flex League playoffs are set — here’s your matchup'
      : '🏆 Flex League playoffs are set — see the board',
    html: shell(inner),
  };
}

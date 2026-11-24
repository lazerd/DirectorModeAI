import 'server-only';
import { createHash } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { APP_URL } from '@/lib/appUrl';
import { standings } from '@/lib/mixer/guestMixer';
import { act, createEvent, PlayError, view } from './server';
import { formatLabel, whenLine, type PlayDraft, type PlayEvent, type PlayRsvp } from './core';
import { DRAW_FORMATS, isDrawFormat, matchEntries, standingsFor, type Draw } from './draw';
import { hostingAllowed, passCheckoutUrl, PASS_PRICES } from './passes';

/**
 * Racquets IRL as an MCP server: the organizer runs a game from Claude or ChatGPT.
 *
 * Same rules as the web page (lib/play/server act/view). The organizer's credential is
 * the game's host key, exactly as on the web: the AI keeps it for the conversation and
 * the organizer gets a host link (/p/<code>?host=<key>) to run the night from their phone.
 * Players never touch the AI: they join, check in and score on the game link.
 */

const TZ = 'America/Los_Angeles';
/** Links the organizer pastes into a group chat: always the current domain, never the legacy one. */
const SITE = APP_URL.replace('club.coachmode.ai', 'clubmode.ai');
const SOCIAL_FORMATS = ['maximize-courts', 'king-of-court', 'team-battle', 'doubles', 'mixed-doubles', 'singles', 'tournament'] as const;

export const MCP_INSTRUCTIONS = [
  'Racquets IRL runs real-life tennis, pickleball and padel games: socials/mixers, round robins, King of the Court, team battles and tournaments.',
  'You act for the ORGANIZER. Players join on the game link (no app, no login), check in when they arrive, and enter scores on their phones.',
  'create_game returns a code and a host_key. Keep the host_key for every later call about that game, and pass it to create_game for the same organizer\'s next game so all their games stay together.',
  'Always give the organizer the share link (for their group chat) and their private host link (to run the night from their phone). Never post the host link where players can see it.',
  'Ask for missing essentials only when needed: sport, when, where, and roughly how many players or courts. Sensible defaults are fine for the rest.',
  'Run it back (run_it_back) makes next week\'s game with the same settings and invites last week\'s players back.',
].join('\n');

const links = (code: string, hostKey?: string | null) => ({
  share: `${SITE}/p/${code}`,
  ...(hostKey ? { host: `${SITE}/p/${code}?host=${encodeURIComponent(hostKey)}` } : {}),
  tv: `${SITE}/p/${code}/tv`,
});

/** The organizer's identity for passes: stable per host key, never the key itself. */
const hostIdOf = (hostKey: string) => 'mcp_' + createHash('sha256').update(hostKey).digest('base64url').slice(0, 32);

type Out = { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
const ok = (text: string, data?: Record<string, unknown>): Out => ({ content: [{ type: 'text', text }], ...(data ? { structuredContent: data } : {}) });
const fail = (text: string): Out => ({ content: [{ type: 'text', text }], isError: true });

/** Every tool answers in words the model can repeat to the organizer, never a stack trace. */
async function guard(f: () => Promise<Out>): Promise<Out> {
  try { return await f(); } catch (e) {
    if (e instanceof PlayError) return fail(e.message === 'PAYWALL' ? 'This needs a Host Pass.' : e.message);
    console.error('[rirl-mcp]', e);
    return fail('Something went wrong on our side. Try again in a moment.');
  }
}

async function mustView(code: string, key?: string | null): Promise<PlayEvent> {
  const e = await view(code.trim().toLowerCase(), key);
  if (!e) throw new PlayError(`No game with code "${code}".`, 404);
  return e;
}
async function hostView(code: string, key: string): Promise<PlayEvent> {
  const e = await mustView(code, key);
  if (!e.isHost) throw new PlayError('That host_key doesn’t match this game. Use the host_key from create_game (or run_it_back) for this code.', 403);
  return e;
}

const live = (e: PlayEvent) => e.rsvps.filter((r) => r.status !== 'out');
function findPlayer(e: PlayEvent, name: string): PlayRsvp {
  const n = name.trim().toLowerCase();
  const all = live(e);
  const hit = all.find((r) => r.name.toLowerCase() === n)
    ?? (all.filter((r) => r.name.toLowerCase().startsWith(n)).length === 1 ? all.find((r) => r.name.toLowerCase().startsWith(n)) : undefined);
  if (!hit) throw new PlayError(`No player named "${name}" on this game. Players: ${all.map((r) => r.name).join(', ') || 'none yet'}.`);
  return hit;
}

/* ---------------- the game, in words ---------------- */

function summary(e: PlayEvent, hostKey?: string | null): { text: string; data: Record<string, unknown> } {
  const L = links(e.code, e.isHost ? hostKey : null);
  const players = live(e);
  const here = players.filter((r) => r.checked_in_at);
  const when = whenLine(e, TZ);
  const lines: string[] = [];
  lines.push(`${e.title} (${e.code}): ${e.status === 'open' ? 'not started' : e.status === 'live' ? 'LIVE' : 'finished'}`);
  lines.push(`${formatLabel(e)} · ${e.sport} · ${e.courts} court${e.courts === 1 ? '' : 's'}${when ? ` · ${when}` : ''}${e.location ? ` · ${e.location}` : ''}${e.level ? ` · level ${e.level}` : ''}`);
  lines.push(`Players (${players.filter((r) => r.status === 'in').length}${e.spots != null ? `/${e.spots}` : ''} in, ${here.length} checked in): ${players.map((r) => `${r.name}${r.checked_in_at ? ' ✓' : ''}${r.status === 'wait' ? ' (waitlist)' : ''}`).join(', ') || 'nobody yet'}`);

  const data: Record<string, unknown> = {
    code: e.code, title: e.title, status: e.status, sport: e.sport, format: e.format, formatLabel: formatLabel(e),
    courts: e.courts, when, location: e.location, level: e.level, spots: e.spots, repeatWeekly: !!e.repeat_weekly,
    links: L, players: players.map((r) => ({ name: r.name, status: r.status, checkedIn: !!r.checked_in_at, gender: r.gender, team: r.team ?? null })),
  };

  const m = e.state?.mixer;
  if (m && m.rounds.length) {
    const name = (id: string) => m.players.find((p) => p.id === id)?.name ?? '?';
    const label = (c: number) => m.courtLabels?.[c - 1] ?? String(c);
    const cur = m.rounds[m.rounds.length - 1];
    lines.push(`Round ${cur.number}:`);
    for (const x of cur.matches) {
      const sc = x.scoreA != null ? ` → ${x.scoreA}-${x.scoreB}${x.tiebreak ? ` (tiebreak ${x.tiebreak})` : ''}` : ' (no score yet)';
      lines.push(`  Court ${label(x.court)}: ${x.teamA.map(name).join(' & ')} vs ${x.teamB.map(name).join(' & ')}${sc}`);
    }
    if (cur.sittingOut.length) lines.push(`  Sitting out: ${cur.sittingOut.map(name).join(', ')}`);
    const st = standings(m).filter((s) => s.played);
    if (st.length) lines.push(`Standings: ${st.slice(0, 12).map((s) => `${s.rank}. ${s.name} ${s.wins}-${s.losses}`).join(' · ')}`);
    data.round = { number: cur.number, matches: cur.matches.map((x) => ({ court: x.court, courtLabel: label(x.court), teamA: x.teamA.map(name), teamB: x.teamB.map(name), scoreA: x.scoreA ?? null, scoreB: x.scoreB ?? null })), sittingOut: cur.sittingOut.map(name) };
    data.rounds = m.rounds.length;
    data.standings = st.map((s) => ({ rank: s.rank, name: s.name, wins: s.wins, losses: s.losses, gamesFor: s.gamesFor, gamesAgainst: s.gamesAgainst }));
  }

  const d: Draw | null | undefined = e.format === 'tournament' ? e.state?.draw : null;
  if (d) {
    const ent = (id: string | null) => (id ? d.entries.find((x) => x.id === id)?.name ?? '?' : 'TBD');
    const open = d.matches.filter((x) => !x.bye && x.status !== 'done' && x.player1_id && x.player3_id);
    lines.push(`Matches to play (use match_key with record_match_result):`);
    for (const x of open.slice(0, 20)) lines.push(`  ${x.key}: ${ent(x.player1_id)} (a) vs ${ent(x.player3_id)} (b)${x.status === 'on_court' && x.court ? ` · on court ${d.courtLabels?.[x.court - 1] ?? x.court}` : ''}`);
    if (!open.length) lines.push('  none');
    const st = standingsFor(d);
    if (st.some((s) => s.played)) lines.push(`Standings: ${st.slice(0, 12).map((s) => `${s.label || s.place}. ${s.name} ${s.wins}-${s.losses}`).join(' · ')}`);
    data.matches = d.matches.filter((x) => !x.bye).map((x) => ({ key: x.key, a: ent(x.player1_id), b: ent(x.player3_id), status: x.status, winner: x.winner ?? null, score: x.score ?? null, court: x.court ?? null, entries: matchEntries(x) }));
    data.standings = st.map((s) => ({ place: s.place, label: s.label, name: s.name, wins: s.wins, losses: s.losses }));
  }

  const rc = e.state?.recap;
  if (rc) { lines.push(`Recap: ${rc.headline}`); lines.push(rc.story); data.recap = { headline: rc.headline, story: rc.story, lines: rc.lines.filter((l) => !l.skipped).map((l) => ({ name: l.name, tag: l.tag, line: l.line })) }; }
  if (e.state?.nextCode) { lines.push(`Next week: ${SITE}/p/${e.state.nextCode}`); data.nextCode = e.state.nextCode; }
  lines.push(`Share link: ${L.share}`);
  if ('host' in L) lines.push(`Host link (organizer only): ${L.host}`);
  return { text: lines.join('\n'), data };
}

function invite(e: PlayEvent): string {
  const when = whenLine(e, TZ);
  return `${e.title}${when ? ` · ${when}` : ''}${e.location ? ` · ${e.location}` : ''}${e.level ? ` · ${e.level}` : ''}\nTap to join: ${SITE}/p/${e.code}`;
}

/* ---------------- tools ---------------- */

const code = z.string().min(4).max(12).describe('The game code, e.g. "k7m2qx"');
const hostKey = z.string().min(8).max(80).describe('The host_key returned by create_game or run_it_back');

export function buildRirlServer(): McpServer {
  const server = new McpServer({ name: 'racquets-irl', version: '1.0.0' }, { instructions: MCP_INSTRUCTIONS });

  server.registerTool('create_game', {
    annotations: { title: 'Create a game', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    title: 'Create a game',
    description: 'Create a tennis, pickleball or padel game, social/mixer, or tournament and get a link players join from (no app or login). '
      + 'Formats: "maximize-courts" (Optimize Courts, the best default for socials: every court full, fewest sit-outs), "king-of-court" (winners move up), '
      + '"team-battle" (two teams), "doubles" (rotating partners), "mixed-doubles", "singles", "tournament" (set tournament_format). '
      + 'Leave spots empty for an open social where whoever shows up plays.',
    inputSchema: {
      sport: z.enum(['tennis', 'pickleball', 'padel']),
      format: z.enum(SOCIAL_FORMATS).optional().describe('Default: maximize-courts for a group, doubles for a single court of 4'),
      tournament_format: z.enum(DRAW_FORMATS as [string, ...string[]]).optional().describe('Only for format "tournament", e.g. rr-singles, rr-doubles, single-elim-singles, fmlc-singles, ffic-doubles, compass-singles, quads, rr-pools-doubles'),
      title: z.string().max(80).optional(),
      starts_at: z.string().optional().describe('ISO 8601 start time WITH timezone offset, e.g. 2026-12-03T18:00:00-08:00'),
      when_text: z.string().max(80).optional().describe('Free-text time if no exact time, e.g. "Saturday morning"'),
      location: z.string().max(120).optional().describe('Club or park name'),
      level: z.string().max(40).optional().describe('e.g. "3.5-4.0" (NTRP) or "3.0+" (DUPR)'),
      courts: z.number().int().min(1).max(24).optional(),
      spots: z.number().int().min(2).max(96).optional().describe('Player cap. Omit for no cap.'),
      round_minutes: z.number().int().min(5).max(120).optional(),
      notes: z.string().max(300).optional(),
      repeat_weekly: z.boolean().optional().describe('Make next week\'s game automatically after this one is played'),
      host_name: z.string().max(40).optional().describe('The organizer\'s name'),
      host_playing: z.boolean().optional().describe('Is the organizer playing too?'),
      host_key: z.string().min(8).max(80).optional().describe('The organizer\'s host_key from an earlier game, so their games stay together'),
    },
  }, async (a) => guard(async () => {
    const draft: Partial<PlayDraft> = {
      sport: a.sport, title: a.title, starts_at: a.starts_at ?? null, when_text: a.when_text ?? null, location: a.location ?? null,
      level: a.level ?? null, courts: a.courts, spots: a.spots ?? null, round_minutes: a.round_minutes, notes: a.notes ?? null,
      repeat_weekly: a.repeat_weekly === true,
      ...(a.format ? { format: a.format } : {}),
    };
    const reuse = a.host_key && (await keyKnown(a.host_key)) ? a.host_key : null;
    const hostId = reuse ? hostIdOf(reuse) : null;
    const gate = await hostingAllowed(hostId, null);
    if (!gate.ok && hostId && passCheckoutUrl('host', hostId)) return paywall(hostId);
    const made = await createEvent(draft, { name: a.host_name ?? null, playing: !!a.host_playing && !!a.host_name }, {
      source: 'mcp', hostId, drawFormat: a.format === 'tournament' && a.tournament_format && isDrawFormat(a.tournament_format) ? a.tournament_format : null,
    });
    // One organizer, one key: their earlier key runs this game too (as run it back does).
    const key = reuse ?? made.hostKey;
    const db = getSupabaseAdmin();
    await db.from('play_events').update({ host_key: key, host_id: hostIdOf(key) }).eq('code', made.code);
    if (reuse && made.playerKey) await db.from('play_rsvps').update({ player_key: key }).eq('player_key', made.hostKey);
    const e = await mustView(made.code, key);
    const s = summary(e, key);
    return ok(`Game created.\nhost_key: ${key} (keep this; it runs the game)\n\nInvite message for the group chat:\n${invite(e)}\n\n${s.text}`, { ...s.data, host_key: key, invite: invite(e) });
  }));

  server.registerTool('get_game', {
    annotations: { title: 'Look at a game', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    title: 'Look at a game',
    description: 'Who is in and checked in, the current round\'s courts and scores, standings, tournament matches still to play, and the recap once it\'s over. Pass host_key to also get the host link.',
    inputSchema: { code, host_key: hostKey.optional() },
  }, async (a) => guard(async () => {
    const e = await mustView(a.code, a.host_key ?? null);
    const s = summary(e, a.host_key);
    return ok(s.text, s.data);
  }));

  server.registerTool('add_players', {
    annotations: { title: 'Add players', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    title: 'Add players',
    description: 'Add people to the game by name (a pasted list is fine). Set here=true if they are already at the courts (checks them in). Gender is only needed for mixed doubles.',
    inputSchema: {
      code, host_key: hostKey,
      players: z.array(z.object({ name: z.string().min(1).max(40), gender: z.enum(['male', 'female']).optional() })).min(1).max(60),
      here: z.boolean().optional().describe('Already at the courts? Default false'),
    },
  }, async (a) => guard(async () => {
    await hostView(a.code, a.host_key);
    await act(a.code, a.host_key, { action: 'add', names: a.players.map((p) => p.name).join('\n'), checkin: a.here === true });
    const e = await mustView(a.code, a.host_key);
    for (const p of a.players.filter((x) => x.gender)) {
      const r = live(e).find((x) => x.name.toLowerCase() === p.name.trim().toLowerCase());
      if (r && r.gender !== p.gender) await act(a.code, a.host_key, { action: 'gender', id: r.id, gender: p.gender });
    }
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(`Added ${a.players.length}.\n${s.text}`, s.data);
  }));

  server.registerTool('check_in', {
    annotations: { title: 'Check players in or out', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'Check players in or out',
    description: 'Only checked-in players get put on courts. Check in named players, or everyone signed up (before the start only). out=true checks them out instead (they stop getting rounds).',
    inputSchema: {
      code, host_key: hostKey,
      names: z.array(z.string().min(1).max(40)).max(60).optional(),
      everyone: z.boolean().optional(),
      out: z.boolean().optional(),
    },
  }, async (a) => guard(async () => {
    const e = await hostView(a.code, a.host_key);
    if (a.everyone) await act(a.code, a.host_key, { action: a.out ? 'checkin_clear' : 'checkin_all' });
    else {
      if (!a.names?.length) throw new PlayError('Say who to check in, or set everyone=true.');
      for (const n of a.names) await act(a.code, a.host_key, { action: a.out ? 'checkout' : 'checkin', id: findPlayer(e, n).id });
    }
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(s.text, s.data);
  }));

  server.registerTool('remove_player', {
    annotations: { title: 'Remove a player', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'Remove a player',
    description: 'Take someone off the game (they left or cancelled). Their finished rounds still count.',
    inputSchema: { code, host_key: hostKey, name: z.string().min(1).max(40) },
  }, async (a) => guard(async () => {
    const e = await hostView(a.code, a.host_key);
    await act(a.code, a.host_key, { action: 'remove', id: findPlayer(e, a.name).id });
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(s.text, s.data);
  }));

  server.registerTool('update_game', {
    annotations: { title: 'Change game details', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'Change game details',
    description: 'Change the time, place, level, number of courts, player cap, round length, format or title. During a live social, a format or court change applies from the next round.',
    inputSchema: {
      code, host_key: hostKey,
      title: z.string().max(80).optional(), starts_at: z.string().optional(), when_text: z.string().max(80).optional(),
      location: z.string().max(120).optional(), level: z.string().max(40).optional(),
      courts: z.number().int().min(1).max(24).optional(), spots: z.number().int().min(2).max(96).nullable().optional().describe('null removes the cap'),
      round_minutes: z.number().int().min(5).max(120).optional(), notes: z.string().max(300).optional(),
      format: z.enum(SOCIAL_FORMATS).optional(), repeat_weekly: z.boolean().optional(),
    },
  }, async (a) => guard(async () => {
    const e = await hostView(a.code, a.host_key);
    const { code: c, host_key: k, repeat_weekly, ...rest } = a;
    const draft = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<PlayDraft>;
    if (Object.keys(draft).length) {
      if (e.status === 'live' && e.format === 'tournament' && Object.keys(draft).every((x) => x === 'courts')) await act(c, k, { action: 'courts', courts: draft.courts });
      else await act(c, k, { action: 'edit', draft });
    }
    if (repeat_weekly !== undefined) await act(c, k, { action: 'weekly', on: repeat_weekly });
    const s = summary(await mustView(c, k), k);
    return ok(`Updated.\n${s.text}`, s.data);
  }));

  server.registerTool('start_game', {
    annotations: { title: 'Start the game', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'Start the game',
    description: 'Start with everyone who is checked in: makes round 1 (social) or the draw (tournament). Players see "You\'re on Court N" on their phones. pairing "smart" balances by level and standings (default); "random" shuffles.',
    inputSchema: { code, host_key: hostKey, pairing: z.enum(['smart', 'random']).optional() },
  }, async (a) => guard(async () => {
    await hostView(a.code, a.host_key);
    await act(a.code, a.host_key, { action: 'start', ...(a.pairing ? { pairing: a.pairing } : {}) });
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(`Started.\n${s.text}`, s.data);
  }));

  server.registerTool('next_round', {
    annotations: { title: 'Next round', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'Next round',
    description: 'Social games only: make the next round from everyone checked in (new partners and opponents, fair sit-outs). Set reshuffle=true to redo the current round instead.',
    inputSchema: { code, host_key: hostKey, reshuffle: z.boolean().optional() },
  }, async (a) => guard(async () => {
    await hostView(a.code, a.host_key);
    await act(a.code, a.host_key, { action: a.reshuffle ? 'reshuffle' : 'next' });
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(s.text, s.data);
  }));

  server.registerTool('record_score', {
    annotations: { title: 'Record a court score (social)', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'Record a court score (social)',
    description: 'Social games: games won by each side on one court. Side A is listed first in get_game. A tied score needs tiebreak_winner. Round defaults to the current round.',
    inputSchema: {
      code, host_key: hostKey,
      court: z.number().int().min(1).max(24).describe('Court position in the round (1 = first court listed)'),
      score_a: z.number().int().min(0).max(99), score_b: z.number().int().min(0).max(99),
      round: z.number().int().min(1).optional(),
      tiebreak_winner: z.enum(['A', 'B']).optional(),
    },
  }, async (a) => guard(async () => {
    const e = await hostView(a.code, a.host_key);
    const m = e.state?.mixer;
    if (!m?.rounds.length) throw new PlayError(e.format === 'tournament' ? 'This is a tournament: use record_match_result.' : 'The game hasn’t started.');
    const round = a.round ?? m.rounds[m.rounds.length - 1].number;
    await act(a.code, a.host_key, { action: 'score', round, court: a.court, a: a.score_a, b: a.score_b, tiebreak: a.tiebreak_winner ?? null });
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(s.text, s.data);
  }));

  server.registerTool('record_match_result', {
    annotations: { title: 'Record a tournament match', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'Record a tournament match',
    description: 'Tournaments: the winner of one match (match_key from get_game), with the score written winner-first or player-a-first, e.g. "6-4, 3-6, 10-7". how "W/O", "RET" or "DEF" for a walkover, retirement or default.',
    inputSchema: {
      code, host_key: hostKey, match_key: z.string().min(1).max(40),
      winner: z.enum(['a', 'b']), score: z.string().max(60).optional(), how: z.enum(['W/O', 'RET', 'DEF']).optional(),
    },
  }, async (a) => guard(async () => {
    await hostView(a.code, a.host_key);
    await act(a.code, a.host_key, a.how ? { action: 'draw_walkover', key: a.match_key, winner: a.winner, how: a.how, score: a.score } : { action: 'draw_score', key: a.match_key, winner: a.winner, score: a.score });
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(s.text, s.data);
  }));

  server.registerTool('end_game', {
    annotations: { title: 'End the game and get the recap', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    title: 'End the game and get the recap',
    description: 'Finish the night: final standings, awards and an AI sportscaster recap players see on the game link. spice: mild (default for tennis), club (default for pickleball) or locker (roast).',
    inputSchema: { code, host_key: hostKey, spice: z.enum(['mild', 'club', 'locker']).optional() },
  }, async (a) => guard(async () => {
    await hostView(a.code, a.host_key);
    await act(a.code, a.host_key, { action: 'end', ...(a.spice ? { spice: a.spice } : {}) });
    const s = summary(await mustView(a.code, a.host_key), a.host_key);
    return ok(`Finished.\n${s.text}\nResults image: ${SITE}/p/${a.code}/results.png`, s.data);
  }));

  server.registerTool('run_it_back', {
    annotations: { title: 'Run it back next week', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    title: 'Run it back next week',
    description: 'Make next week\'s game with the same settings (same host key). Returns the new code and an invite message for last week\'s group.',
    inputSchema: { code, host_key: hostKey },
  }, async (a) => guard(async () => {
    await hostView(a.code, a.host_key);
    try {
      const out = await act(a.code, a.host_key, { action: 'runback' });
      const e = await mustView(out.code!, a.host_key);
      const s = summary(e, a.host_key);
      return ok(`Next week's game is ready (same host_key).\n\nInvite message:\n${invite(e)}\n\n${s.text}`, { ...s.data, host_key: a.host_key, invite: invite(e) });
    } catch (x) {
      if (x instanceof PlayError && x.status === 402) return paywall(hostIdOf(a.host_key));
      throw x;
    }
  }));

  return server;
}

async function keyKnown(key: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin().from('play_events').select('id').eq('host_key', key).limit(1);
  return !!data?.length;
}

function paywall(hostId: string): Out {
  const url = passCheckoutUrl('host', hostId);
  return ok(`Your first game is free. Hosting more (and weekly run-backs) takes a Host Pass: $${PASS_PRICES.host}/year, unlimited games.${url ? `\nGet it here: ${url}` : ''}\nOnce it's paid, ask again.`, { paywall: true, checkout: url, price: PASS_PRICES.host });
}

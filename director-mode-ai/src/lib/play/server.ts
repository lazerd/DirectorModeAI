import 'server-only';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { generateRound, newMixer, roundComplete, cannotGenerate, type GuestMixer, type GuestRound } from '@/lib/mixer/guestMixer';
import { crownFor } from './crown';
import { hostingAllowed, passCheckoutUrl } from './passes';
import { callTheGame, hypeJoin, hypePreview, softenLine, type Spice } from './recap';
import { FORMAT_NAME, whenLine } from './core';
import { crownChanged, nearbyNeedOne, watchCrown } from './notify';
import { LEVEL_SCALE, levelNum, type LevelSport } from './levels';
import { standings } from '@/lib/mixer/guestMixer';
import { normalizeDraft, type PlayDraft, type PlayEvent, type PlayRsvp, type PlayState } from './core';

const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
const code = (n = 6) => [...randomBytes(n)].map((b) => ALPHA[b % ALPHA.length]).join('');
export const newKey = () => randomBytes(18).toString('base64url');

export class PlayError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

type Row = PlayDraft & { id: string; code: string; host_key: string; host_name: string | null; status: PlayEvent['status']; state: PlayState; version: number; created_at: string; parent_id: string | null };

export async function loadRow(c: string): Promise<Row | null> {
  const { data } = await getSupabaseAdmin().from('play_events').select('*').eq('code', c.toLowerCase()).maybeSingle();
  return (data as Row) ?? null;
}
async function loadRsvps(eventId: string) {
  const { data } = await getSupabaseAdmin().from('play_rsvps').select('*').eq('event_id', eventId).order('created_at');
  return (data ?? []) as (PlayRsvp & { player_key: string; event_id: string })[];
}

/** The page's view of an event for whoever holds `key` (host key or a player key). */
export async function view(c: string, key?: string | null): Promise<PlayEvent | null> {
  let row = await loadRow(c);
  if (!row) return null;
  if (weeklyDue(row)) { await makeNext(row, await loadRsvps(row.id), true).catch(async (x) => {
    const msg = x instanceof Error ? x.message : String(x);
    if (msg === 'paywall') { if (!row!.state?.weeklyPaywall) await mutate(row!, (r) => ({ state: { ...r.state, weeklyPaywall: true } })); }
    else console.error('[play] weekly next failed', row!.code, msg);
    return null;
  }); row = (await loadRow(c)) ?? row; }
  const rs = await loadRsvps(row.id);
  const me = key ? rs.find((r) => r.player_key === key && r.status !== 'out') ?? null : null;
  let prevCode: string | null = null;
  if (row.parent_id) {
    const { data } = await getSupabaseAdmin().from('play_events').select('code').eq('id', row.parent_id).maybeSingle();
    prevCode = data?.code ?? null;
  }
  const { host_key, id, parent_id, ...pub } = row as Row & { source_text?: string; updated_at?: string };
  delete (pub as Record<string, unknown>).source_text;
  const cr = row.location ? await crownFor(row.location, { excludeCode: row.status === 'done' ? undefined : row.code }).catch(() => null) : null;
  const slim = (r: { name: string; wins: number } | null | undefined) => (r ? { name: r.name, wins: r.wins } : null);
  return {
    ...(pub as Omit<Row, 'host_key' | 'id' | 'parent_id'>),
    crown: cr ? { slug: cr.slug, place: cr.place, king: slim(cr.king), queen: slim(cr.queen) } : null,
    rsvps: rs.filter((r) => r.status !== 'out').map(({ id, name, gender, level, level_num, status, is_host, created_at, team, checked_in_at }) => ({ id, name, gender, level, level_num: level_num == null ? null : Number(level_num), status, is_host, created_at, team: team ?? null, checked_in_at: checked_in_at ?? null })),
    level_min: row.level_min == null ? null : Number(row.level_min),
    level_max: row.level_max == null ? null : Number(row.level_max),
    season: await seasonFor(row).catch(() => null),
    isHost: !!key && key === host_key,
    me: me?.id ?? null,
    prevCode,
  };
}

export async function createEvent(d: Partial<PlayDraft>, host: { name?: string | null; playing?: boolean; gender?: 'male' | 'female' | null }, opts: { source?: string; parentId?: string; hostId?: string | null; clubCode?: string | null } = {}) {
  const db = getSupabaseAdmin();
  const draft = normalizeDraft(d);
  const hostKey = newKey();
  for (let i = 0; i < 5; i++) {
    const c = code();
    const { data, error } = await db.from('play_events').insert({
      ...draft, code: c, host_key: hostKey, host_name: host.name?.trim().slice(0, 40) || null,
      source_text: opts.source?.slice(0, 500) ?? null, parent_id: opts.parentId ?? null, state: {},
      host_id: opts.hostId?.slice(0, 64) ?? null, club_code: opts.clubCode?.slice(0, 20) ?? null,
    }).select('id, code').single();
    if (error?.code === '23505') continue;
    if (error) throw new PlayError(error.message, 500);
    let playerKey: string | null = null;
    if (host.playing && host.name?.trim()) {
      playerKey = hostKey; // the host's own RSVP answers to the host key
      await db.from('play_rsvps').insert({ event_id: data.id, name: host.name.trim().slice(0, 40), gender: host.gender ?? null, player_key: hostKey, is_host: true, status: 'in', team: draft.format === 'team-battle' ? 'A' : null });
    }
    return { code: data.code as string, hostKey, playerKey };
  }
  throw new PlayError('Could not make a link, try again.', 500);
}

/** Read-modify-write on the event row, retried when someone else wrote first. */
async function mutate(row: Row, fn: (r: Row) => Partial<Row> | null) {
  const db = getSupabaseAdmin();
  let cur = row;
  for (let i = 0; i < 5; i++) {
    const patch = fn(cur);
    if (!patch) return;
    const { data } = await db.from('play_events').update({ ...patch, version: cur.version + 1, updated_at: new Date().toISOString() })
      .eq('id', cur.id).eq('version', cur.version).select('id');
    if (data?.length) return;
    const fresh = await loadRow(cur.code);
    if (!fresh) throw new PlayError('Event not found', 404);
    cur = fresh;
  }
  throw new PlayError('Busy, try again.', 409);
}

const mixerOf = (r: Row): GuestMixer => r.state?.mixer ?? { ...newMixer(), name: r.title, courts: r.courts, format: r.format };

async function promoteWaitlist(row: Row) {
  const db = getSupabaseAdmin();
  const rs = await loadRsvps(row.id);
  const inN = rs.filter((r) => r.status === 'in').length;
  const waiting = rs.filter((r) => r.status === 'wait');
  const open = row.spots == null ? waiting.length : Math.max(0, row.spots - inN);
  for (const w of waiting.slice(0, open)) await db.from('play_rsvps').update({ status: 'in' }).eq('id', w.id);
}

/** A newcomer during a live event joins the rotation from the next round. */
async function addToMixer(row: Row, p: { id: string; name: string; gender: 'male' | 'female' | null; team?: 'A' | 'B' | null; level?: number | null }) {
  await mutate(row, (r) => {
    if (r.status !== 'live' || !r.state?.mixer) return null;
    const m = r.state.mixer;
    if (m.players.some((x) => x.id === p.id && !x.out)) return null;
    const players = m.players.some((x) => x.id === p.id)
      ? m.players.map((x) => (x.id === p.id ? { ...x, out: false } : x))
      : [...m.players, { id: p.id, name: p.name, ...(p.gender ? { gender: p.gender } : {}), ...(p.team ? { team: p.team } : {}), ...(p.level != null ? { level: p.level } : {}) }];
    return { state: { ...r.state, mixer: { ...m, players } } };
  });
}

type Body = Record<string, unknown>;
const s = (v: unknown, n = 40) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const gender = (v: unknown) => (v === 'male' || v === 'female' ? v : null);
const lvl = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const nowIso = () => new Date().toISOString();
/** Mark one player out of the live rotation (left, removed or checked out). */
const outOfMixer = (id: string) => (r: Row) => r.state?.mixer ? { state: { ...r.state, mixer: { ...r.state.mixer, players: r.state.mixer.players.map((p) => p.id === id ? { ...p, out: true } : p) } } } : null;
/** A court list typed by the host: "5,6,7,8" or "5-8" or "Center, 2, 3". */
function parseLabels(v: unknown): string[] | null {
  const raw = String(v ?? '').trim();
  if (!raw) return null;
  const range = raw.match(/^(\d{1,3})\s*[-–]\s*(\d{1,3})$/);
  if (range) { const a = +range[1], b = +range[2]; if (b >= a && b - a < 24) return Array.from({ length: b - a + 1 }, (_, i) => String(a + i)); }
  const parts = raw.split(/[,;\n]+|\s+(?=\d)/).map((x) => x.trim().slice(0, 12)).filter(Boolean).slice(0, 24);
  return parts.length ? parts : null;
}
/** Swap two players' places in a round (on a court or sitting out). Scores on touched courts are cleared. */
function swapIn(r: GuestRound, a: string, b: string): GuestRound {
  if (a === b) return r;
  const put = (id: string) => (id === a ? b : id === b ? a : id);
  const touched = new Set<number>();
  const matches = r.matches.map((x) => {
    const has = [...x.teamA, ...x.teamB].some((id) => id === a || id === b);
    if (!has) return x;
    touched.add(x.court);
    return { ...x, teamA: x.teamA.map(put), teamB: x.teamB.map(put), scoreA: null, scoreB: null, tiebreak: null };
  });
  return { ...r, matches, sittingOut: r.sittingOut.map(put) };
}

export async function act(c: string, key: string | null, body: Body): Promise<{ playerKey?: string; code?: string }> {
  const db = getSupabaseAdmin();
  const row = await loadRow(c);
  if (!row) throw new PlayError('Event not found', 404);
  const isHost = !!key && key === row.host_key;
  const rs = await loadRsvps(row.id);
  const mine = key ? rs.find((r) => r.player_key === key) : undefined;
  const action = String(body.action || '');
  const hostOnly = () => { if (!isHost) throw new PlayError('Only the host can do that.', 403); };

  switch (action) {
    case 'join': {
      const name = s(body.name);
      if (!name) throw new PlayError('Add your name.');
      if (row.status === 'done') throw new PlayError('This one is over.');
      if (mine && mine.status !== 'out') return { playerKey: mine.player_key };
      const dupe = rs.find((r) => r.status !== 'out' && r.name.toLowerCase() === name.toLowerCase());
      if (dupe) throw new PlayError(`${name} is already in. Add a last initial so we can tell you apart.`);
      const inN = rs.filter((r) => r.status === 'in').length;
      const status = row.status === 'live' || row.spots == null || inN < row.spots ? 'in' : 'wait';
      // Joining at the courts (live, or the court QR's ?here) also checks you in.
      const here = row.status === 'live' || body.here === true;
      const pk = mine?.player_key ?? newKey();
      let team: 'A' | 'B' | null = body.team === 'A' || body.team === 'B' ? body.team : null;
      if (row.format === 'team-battle' && !team) {
        const live = rs.filter((r) => r.status === 'in');
        team = live.filter((r) => r.team === 'A').length <= live.filter((r) => r.team === 'B').length ? 'A' : 'B';
      }
      const sc = LEVEL_SCALE[(row.sport as LevelSport) in LEVEL_SCALE ? (row.sport as LevelSport) : 'tennis'];
      const ln = Number(body.level_num);
      const level_num = body.level_num != null && body.level_num !== '' && Number.isFinite(ln) && ln >= sc.min && ln <= sc.max ? Math.round(ln * 100) / 100 : null;
      const levelText = level_num != null ? `${levelNum(level_num)} ${sc.short}` : s(body.level, 20) || null;
      // Someone who left (or was removed) and comes back keeps their row, so their rounds still count.
      const back = !mine ? rs.find((r) => r.status === 'out' && r.name.toLowerCase() === name.toLowerCase()) : undefined;
      const fields = { name, gender: gender(body.gender), level: levelText, level_num, player_key: pk, status, team, ...(here ? { checked_in_at: nowIso(), checked_in_by: 'self' } : {}) };
      const { data, error } = back
        ? await db.from('play_rsvps').update(fields).eq('id', back.id).select('id').single()
        : await db.from('play_rsvps').insert({ event_id: row.id, ...fields }).select('id').single();
      if (error) throw new PlayError(error.message, 500);
      if (row.status === 'live') await addToMixer(row, { id: data.id, name, gender: gender(body.gender), team, level: level_num });
      if (row.status === 'open' && status === 'in') await hype(c, { id: data.id, name }).catch(() => {});
      return { playerKey: pk };
    }
    case 'leave': {
      if (!mine) throw new PlayError('You are not on this one.');
      await db.from('play_rsvps').update({ status: 'out', checked_in_at: null, checked_in_by: null }).eq('id', mine.id);
      if (row.status === 'open') { await promoteWaitlist(row); await nearbyNeedOne(row.code).catch(() => {}); }
      if (row.status === 'live') await mutate(row, outOfMixer(mine.id));
      return {};
    }
    case 'add': { // walk-ups, pasted lists: host only
      hostOnly();
      const names = String(body.names ?? '').split(/[\n,;]+/).map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim().slice(0, 40)).filter(Boolean).slice(0, 60);
      const have = new Set(rs.filter((r) => r.status !== 'out').map((r) => r.name.toLowerCase()));
      // The host typing names = these people are at the courts: they're checked in.
      const checkin = body.checkin !== false;
      for (const name of names) {
        if (have.has(name.toLowerCase())) continue; have.add(name.toLowerCase());
        const back = rs.find((r) => r.status === 'out' && r.name.toLowerCase() === name.toLowerCase());
        const fields = { name, status: 'in', ...(checkin ? { checked_in_at: nowIso(), checked_in_by: 'host' } : {}) };
        const { data } = back
          ? await db.from('play_rsvps').update(fields).eq('id', back.id).select('id, gender, level_num, team').single()
          : await db.from('play_rsvps').insert({ event_id: row.id, player_key: newKey(), ...fields }).select('id, gender, level_num, team').single();
        if (data && row.status === 'live' && checkin) await addToMixer((await loadRow(c))!, { id: data.id, name, gender: gender(data.gender), team: data.team ?? null, level: lvl(data.level_num) });
      }
      if (row.status === 'open' && row.spots != null) {
        const n = (await loadRsvps(row.id)).filter((r) => r.status === 'in').length;
        if (n > row.spots) await mutate(row, () => ({ spots: Math.min(96, n) }));
      }
      return {};
    }
    case 'remove': {
      hostOnly();
      const id = s(body.id, 60);
      await db.from('play_rsvps').update({ status: 'out', checked_in_at: null, checked_in_by: null }).eq('id', id).eq('event_id', row.id);
      if (row.status === 'open') await nearbyNeedOne(row.code).catch(() => {});
      if (row.status === 'live') await mutate(row, outOfMixer(id));
      else await promoteWaitlist(row);
      return {};
    }
    case 'checkin':
    case 'checkout': { // the host checks anyone in/out; a player only themselves ("I'm here")
      const id = s(body.id, 60) || mine?.id || '';
      if (!id) throw new PlayError('Join first, then check in.', 403);
      if (!isHost && mine?.id !== id) throw new PlayError('Only the host can check someone else in.', 403);
      const r0 = rs.find((r) => r.id === id && r.status !== 'out');
      if (!r0) throw new PlayError('That player isn’t on this one.');
      if (row.status === 'done') throw new PlayError('This one is over.');
      if (action === 'checkin') {
        // Waitlisted but here: they play. A cap is a sign-up limit, not a reason to bench someone who showed.
        await db.from('play_rsvps').update({ checked_in_at: r0.checked_in_at ?? nowIso(), checked_in_by: isHost ? 'host' : 'self', status: 'in' }).eq('id', id);
        if (row.status === 'live') await addToMixer(row, { id, name: r0.name, gender: gender(r0.gender), team: r0.team ?? null, level: lvl(r0.level_num) });
      } else {
        await db.from('play_rsvps').update({ checked_in_at: null, checked_in_by: null }).eq('id', id);
        if (row.status === 'live') await mutate(row, outOfMixer(id));
      }
      return {};
    }
    case 'checkin_all':
    case 'checkin_clear': {
      hostOnly();
      if (row.status !== 'open') throw new PlayError('Check people in or out one at a time once you’ve started.');
      const ids = rs.filter((r) => r.status === 'in').map((r) => r.id);
      if (ids.length) await db.from('play_rsvps').update(action === 'checkin_all' ? { checked_in_at: nowIso(), checked_in_by: 'host' } : { checked_in_at: null, checked_in_by: null }).in('id', ids).eq('event_id', row.id);
      return {};
    }
    case 'gender': { // mixed doubles needs M/W: the player or the host sets it
      const id = s(body.id, 60);
      if (!isHost && mine?.id !== id) throw new PlayError('Not allowed.', 403);
      const g = gender(body.gender);
      await db.from('play_rsvps').update({ gender: g }).eq('id', id).eq('event_id', row.id);
      await mutate(row, (r) => r.state?.mixer ? { state: { ...r.state, mixer: { ...r.state.mixer, players: r.state.mixer.players.map((p) => p.id === id ? { ...p, gender: g ?? undefined } : p) } } } : null);
      return {};
    }
    case 'edit': {
      hostOnly();
      const d = normalizeDraft({ ...row, ...(body.draft as Partial<PlayDraft>) });
      // A live night can switch format (people didn't show: doubles -> Optimize Courts); it applies from the next round.
      await mutate(row, (r) => ({ ...d, state: r.state?.mixer ? { ...r.state, mixer: { ...r.state.mixer, courts: d.courts, format: d.format, name: d.title } } : r.state }));
      if (row.status === 'open') await promoteWaitlist({ ...row, spots: d.spots });
      return {};
    }
    case 'team': { // Team Battle: a player picks their side, or the host moves anyone
      const id = s(body.id, 60) || mine?.id || '';
      if (!isHost && mine?.id !== id) throw new PlayError('Not allowed.', 403);
      const t = body.team === 'A' || body.team === 'B' ? body.team : null;
      await db.from('play_rsvps').update({ team: t }).eq('id', id).eq('event_id', row.id);
      await mutate(row, (r) => r.state?.mixer ? { state: { ...r.state, mixer: { ...r.state.mixer, players: r.state.mixer.players.map((p) => p.id === id ? { ...p, team: t ?? undefined } : p) } } } : null);
      return {};
    }
    case 'weekly': {
      hostOnly();
      await mutate(row, () => ({ repeat_weekly: body.on === true }));
      return {};
    }
    case 'list': {
      hostOnly();
      if (body.on === true && row.place_lat == null) throw new PlayError('Pin the place on the map first, so nearby players can find it.');
      await mutate(row, () => ({ listed: body.on === true }));
      if (body.on === true) await nearbyNeedOne(row.code).catch(() => {});
      return {};
    }
    case 'teamnames': {
      hostOnly();
      const A = s(body.A, 24) || 'Team A', B = s(body.B, 24) || 'Team B';
      await mutate(row, (r) => ({ state: { ...r.state, teamNames: { A, B } } }));
      return {};
    }
    case 'watch': {
      if (!mine) throw new PlayError('Join first, then you can get crown alerts.', 403);
      if (!row.location) throw new PlayError('This game has no place, so there is no crown to watch.');
      const ok = await watchCrown(row.location, mine.name, String(body.email ?? ''));
      if (!ok) throw new PlayError('That email doesn’t look right.');
      return {};
    }
    case 'hype': {
      hostOnly();
      await hype(c, null);
      return {};
    }
    case 'start': {
      hostOnly();
      if (row.status !== 'open') throw new PlayError('Already started.');
      // Only people who are actually here play (MixerMode's check-in). Signed up but not here = sits until checked in.
      const here = rs.filter((r) => r.status !== 'out' && r.checked_in_at);
      if (!here.length) throw new PlayError('Nobody is checked in yet. Check people in as they arrive, or tap “Check in everyone”.');
      for (const r of here.filter((x) => x.status === 'wait')) { r.status = 'in'; await db.from('play_rsvps').update({ status: 'in' }).eq('id', r.id); }
      if (row.format === 'team-battle') { // anyone without a side goes to the smaller team
        const ins = here;
        for (const r of ins.filter((x) => !x.team)) {
          const t = ins.filter((x) => x.team === 'A').length <= ins.filter((x) => x.team === 'B').length ? 'A' : 'B';
          r.team = t; await db.from('play_rsvps').update({ team: t }).eq('id', r.id);
        }
      }
      const players = here.map((r) => ({ id: r.id, name: r.name, ...(r.gender ? { gender: r.gender } : {}), ...(r.team ? { team: r.team } : {}), ...(lvl(r.level_num) != null ? { level: lvl(r.level_num) } : {}) }));
      await mutate(row, (r) => {
        const m: GuestMixer = { ...newMixer(), name: r.title, courts: r.courts, format: r.format, players, rounds: [],
          pairing: body.pairing === 'random' || r.state?.pairingPref === 'random' ? 'random' : 'smart',
          courtLabels: r.state?.courtLabels ?? null, teamSplit: r.state?.teamSplit ?? null };
        const why = cannotGenerate(m);
        if (why) throw new PlayError(why);
        m.rounds = [generateRound(m)];
        return { status: 'live', state: { ...r.state, mixer: m, roundStartedAt: nowIso(), pausedAt: null } };
      });
      return {};
    }
    case 'next':
    case 'reshuffle': {
      hostOnly();
      await mutate(row, (r) => {
        const m = mixerOf(r);
        const replace = action === 'reshuffle' && m.rounds.length > 0;
        const why = cannotGenerate(replace ? { ...m, rounds: m.rounds.slice(0, -1) } : m);
        if (why) throw new PlayError(why);
        const round = generateRound(m, { replaceLast: replace });
        const rounds = replace ? [...m.rounds.slice(0, -1), round] : [...m.rounds, round];
        return { state: { ...r.state, mixer: { ...m, rounds }, roundStartedAt: nowIso(), pausedAt: null } };
      });
      return {};
    }
    case 'courts': {
      hostOnly();
      const n = Math.min(24, Math.max(1, Math.round(Number(body.courts))));
      await mutate(row, (r) => ({ courts: n, state: r.state?.mixer ? { ...r.state, mixer: { ...r.state.mixer, courts: n } } : r.state }));
      return {};
    }
    case 'score': {
      if (!isHost && !mine) throw new PlayError('Join first, then you can enter scores.', 403);
      const rn = Number(body.round), ct = Number(body.court);
      const num = (v: unknown) => (v === null || v === '' || v === undefined || !Number.isFinite(Number(v)) ? null : Math.min(99, Math.max(0, Math.round(Number(v)))));
      const a = num(body.a), b = num(body.b);
      if ((a == null) !== (b == null)) throw new PlayError('Enter both scores.');
      if (a != null && a === 0 && b === 0) throw new PlayError('0–0 isn’t a score. Enter the games each side won.');
      const tb: 'A' | 'B' | null = body.tiebreak === 'A' || body.tiebreak === 'B' ? body.tiebreak : null;
      if (a != null && a === b && !tb) throw new PlayError(`Tied ${a}–${b}. Who won the tiebreak?`);
      await mutate(row, (r) => {
        const m = r.state?.mixer; if (!m) throw new PlayError('Not started yet.');
        // Players score the current round while it's live; past rounds and finished nights are the host's to fix.
        if (!isHost && (r.status !== 'live' || rn !== m.rounds[m.rounds.length - 1]?.number)) throw new PlayError('Scores for that round are locked. Ask the host to fix it.', 403);
        if (!m.rounds.some((x) => x.number === rn && x.matches.some((y) => y.court === ct))) throw new PlayError('That court isn’t in this round.');
        const rounds = m.rounds.map((x) => x.number !== rn ? x : { ...x, matches: x.matches.map((y) => y.court !== ct ? y : { ...y, scoreA: a, scoreB: b, tiebreak: a != null && a === b ? tb : null }) });
        return { state: { ...r.state, mixer: { ...m, rounds } } };
      });
      return {};
    }
    case 'swap': { // host: swap two players in the current round (or pull a sit-out onto a court)
      hostOnly();
      const a = s(body.a, 60), b = s(body.b, 60);
      await mutate(row, (r) => {
        const m = r.state?.mixer; if (!m?.rounds.length) throw new PlayError('Start first.');
        const last = m.rounds[m.rounds.length - 1];
        const inRound = (id: string) => last.sittingOut.includes(id) || last.matches.some((x) => [...x.teamA, ...x.teamB].includes(id));
        if (!inRound(a) || !inRound(b)) throw new PlayError('Both players need to be in this round.');
        return { state: { ...r.state, mixer: { ...m, rounds: [...m.rounds.slice(0, -1), swapIn(last, a, b)] } } };
      });
      return {};
    }
    case 'undo_round':
    case 'reset_rounds': { // host: take back the last round, or start the rounds over (players stay)
      hostOnly();
      await mutate(row, (r) => {
        const m = r.state?.mixer; if (!m) throw new PlayError('Start first.');
        const rounds = action === 'reset_rounds' ? [] : m.rounds.slice(0, -1);
        return { state: { ...r.state, mixer: { ...m, rounds }, roundStartedAt: rounds.length ? r.state.roundStartedAt : null, pausedAt: null } };
      });
      return {};
    }
    case 'timer': { // host: pause / resume / +N minutes / restart the round clock
      hostOnly();
      const op = s(body.op, 10);
      await mutate(row, (r) => {
        const st = r.state ?? {};
        const start = st.roundStartedAt ? Date.parse(st.roundStartedAt) : null;
        if (op === 'restart') return { state: { ...st, roundStartedAt: nowIso(), pausedAt: null } };
        if (start == null) throw new PlayError('No round clock running.');
        if (op === 'pause') return st.pausedAt ? null : { state: { ...st, pausedAt: nowIso() } };
        if (op === 'resume') return st.pausedAt ? { state: { ...st, roundStartedAt: new Date(start + (Date.now() - Date.parse(st.pausedAt))).toISOString(), pausedAt: null } } : null;
        if (op === 'extend') { const min = Math.min(30, Math.max(1, Math.round(Number(body.min) || 5))); return { state: { ...st, roundStartedAt: new Date(start + min * 60e3).toISOString() } }; }
        throw new PlayError('Unknown timer action');
      });
      return {};
    }
    case 'labels': { // host: the club's court numbers ("5-8", "5,6,7,8", "Center, 2, 3")
      hostOnly();
      const labels = parseLabels(body.labels);
      await mutate(row, (r) => ({ state: { ...r.state, courtLabels: labels, ...(r.state?.mixer ? { mixer: { ...r.state.mixer, courtLabels: labels } } : {}) } }));
      return {};
    }
    case 'pairing': { // host: smart (balanced by level, then by standings) or random shuffle
      hostOnly();
      const mode = body.mode === 'random' ? 'random' : 'smart';
      await mutate(row, (r) => r.state?.mixer ? { state: { ...r.state, mixer: { ...r.state.mixer, pairing: mode } } } : { state: { ...r.state, pairingPref: mode } });
      return {};
    }
    case 'teamsplit': { // host: Team Battle court split (how many singles vs doubles courts)
      hostOnly();
      const auto = body.auto === true;
      const split = auto ? null : { singles: Math.max(0, Math.min(24, Math.round(Number(body.singles) || 0))), doubles: Math.max(0, Math.min(24, Math.round(Number(body.doubles) || 0))) };
      if (split && split.singles + split.doubles < 1) throw new PlayError('Use at least one court.');
      await mutate(row, (r) => r.state?.mixer ? { state: { ...r.state, mixer: { ...r.state.mixer, teamSplit: split } } } : { state: { ...r.state, teamSplit: split } });
      return {};
    }
    case 'end':
    case 'recap': {
      hostOnly();
      if (action === 'end') {
        await mutate(row, (r) => ({ status: 'done', state: { ...r.state, mixer: r.state?.mixer ? { ...r.state.mixer, rounds: r.state.mixer.rounds.filter((x, i, all) => i < all.length - 1 || x.matches.some((y) => y.scoreA != null)) } : r.state?.mixer } }));
      }
      const fresh = (await loadRow(c))!;
      const m = fresh.state?.mixer;
      if (!m) return {};
      const spice: Spice = body.spice === 'mild' || body.spice === 'locker' || body.spice === 'club' ? body.spice : fresh.sport === 'pickleball' ? 'club' : 'mild';
      let crown = null;
      if (fresh.location) {
        const [before, after] = await Promise.all([crownFor(fresh.location, { excludeCode: fresh.code }), crownFor(fresh.location)]);
        if (after) crown = { place: after.place, before: before?.king?.name ?? null, after: after.king?.name ?? null };
      }
      const named = fresh.state?.teamNames ? ({ ...m, teamNames: fresh.state.teamNames } as typeof m) : m;
      const recap = await callTheGame(named, fresh.title, spice, crown).catch((e) => { console.error('[play] recap failed', e); return null; });
      if (recap) await mutate(fresh, (r) => ({ state: { ...r.state, recap } }));
      if (action === 'end' && crown) await crownChanged(crown.place, crown.before, crown.after).catch((e) => console.error('[play] crown alert failed', e));
      return {};
    }
    case 'recap_me': {
      if (!mine) throw new PlayError('Not allowed.', 403);
      const mode = body.mode === 'skip' ? 'skip' : body.mode === 'show' ? 'show' : 'soften';
      const cur = row.state?.recap;
      const ln = cur?.lines.find((l) => l.id === mine.id);
      if (!cur || !ln || !row.state?.mixer) return {};
      let text = ln.line;
      if (mode === 'soften') text = (await softenLine(row.state.mixer, row.title, ln).catch(() => null)) ?? ln.line;
      await mutate(row, (r) => r.state?.recap ? { state: { ...r.state, recap: { ...r.state.recap, lines: r.state.recap.lines.map((l) => l.id !== mine.id ? l : { ...l, line: text, skipped: mode === 'skip' }) } } } : null);
      return {};
    }
    case 'reopen': {
      hostOnly();
      await mutate(row, (r) => ({ status: r.state?.mixer ? 'live' : 'open' }));
      return {};
    }
    case 'runback': {
      hostOnly();
      return { code: await makeNext(row, rs, false) };
    }
    default:
      throw new PlayError('Unknown action');
  }
}

/** Next week's game in the series (Run it back, or automatic for a weekly series). */
async function makeNext(row: Row, rs: Awaited<ReturnType<typeof loadRsvps>>, auto: boolean): Promise<string> {
  if (row.state?.nextCode) return row.state.nextCode;
  const db = getSupabaseAdmin();
  const next = row.starts_at ? new Date(Date.parse(row.starts_at) + 7 * 864e5).toISOString() : null;
  const host = rs.find((r) => r.is_host && r.status === 'in');
  const r2 = row as Row & { host_id?: string | null; club_code?: string | null };
  const gate = await hostingAllowed(r2.host_id ?? null, r2.club_code ?? null, { runback: true });
  if (!gate.ok && passCheckoutUrl('host', r2.host_id ?? 'x')) { if (auto) throw new Error('paywall'); throw new PlayError('PAYWALL', 402); }
  const made = await createEvent({ ...row, starts_at: next, when_text: next ? null : row.when_text }, { name: row.host_name, playing: !!host, gender: host?.gender ?? null }, { parentId: row.id, hostId: r2.host_id, clubCode: r2.club_code });
  // the new event answers to the same host key
  await db.from('play_events').update({ host_key: row.host_key }).eq('code', made.code);
  if (host) await db.from('play_rsvps').update({ player_key: row.host_key }).eq('player_key', made.hostKey);
  await mutate(row, (r) => ({ state: { ...r.state, nextCode: made.code, weeklyPaywall: false } }));
  if (row.listed) await nearbyNeedOne(made.code).catch(() => {});
  return made.code;
}

/** A weekly game makes next week's once it's been played (ended, or 4 hours past its start). */
function weeklyDue(row: Row): boolean {
  if (!row.repeat_weekly || row.state?.nextCode || !row.starts_at) return false;
  return row.status === 'done' || Date.parse(row.starts_at) + 4 * 3600e3 < Date.now();
}

/** The running table for a weekly series: every night's mixer, added up by name. */
async function seasonFor(row: Row): Promise<PlayEvent['season']> {
  if (!row.parent_id && !row.repeat_weekly && !row.state?.nextCode) return null;
  const { data } = await getSupabaseAdmin().from('play_events').select('id, parent_id, state').eq('host_key', row.host_key).order('created_at').limit(200);
  const all = (data ?? []) as { id: string; parent_id: string | null; state: PlayState }[];
  const byId = new Map(all.map((x) => [x.id, x]));
  let first = byId.get(row.id); let guard = 0;
  while (first?.parent_id && byId.has(first.parent_id) && guard++ < 100) first = byId.get(first.parent_id);
  const chain: typeof all = []; let cur = first; guard = 0;
  while (cur && guard++ < 100) { chain.push(cur); const id = cur.id; cur = all.find((x) => x.parent_id === id); }
  const played = chain.filter((x) => x.state?.mixer?.rounds?.some((r) => r.matches.some((m) => m.scoreA != null)));
  if (played.length < 2) return null;
  const tab = new Map<string, { name: string; nights: number; wins: number; losses: number; games: number }>();
  for (const night of played) {
    for (const st of standings(night.state.mixer!)) {
      if (!st.played) continue;
      const k = st.name.trim().toLowerCase();
      const t = tab.get(k) ?? { name: st.name, nights: 0, wins: 0, losses: 0, games: 0 };
      t.nights++; t.wins += st.wins; t.losses += st.losses; t.games += st.gamesFor;
      tab.set(k, t);
    }
  }
  const rows = [...tab.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.games - a.games).slice(0, 30);
  return { nights: played.length, rows };
}

/** Pre-game hype: a whole preview, or one new line for a player who just joined. */
async function hype(c: string, joined: { id: string; name: string } | null) {
  const row = await loadRow(c);
  if (!row || row.status !== 'open') return;
  const rs = (await loadRsvps(row.id)).filter((r) => r.status === 'in');
  const ev = { title: row.title, when: whenLine(row, 'America/Los_Angeles'), location: row.location, level: row.level, spots: row.spots ?? 0, sport: row.sport, format: FORMAT_NAME[row.format as keyof typeof FORMAT_NAME] ?? row.format };
  const cur = row.state?.preview;
  if (joined && cur) {
    const line = await hypeJoin(ev, joined.name, rs.filter((r) => r.id !== joined.id).map((r) => r.name));
    if (!line) return;
    await mutate(row, (r) => r.state?.preview ? { state: { ...r.state, preview: { ...r.state.preview, lines: [...r.state.preview.lines.filter((l) => l.id !== joined.id), { id: joined.id, name: joined.name, line }] } } } : null);
    return;
  }
  if (!rs.length) return;
  const p = await hypePreview(ev, rs.map((r) => ({ id: r.id, name: r.name })));
  if (p) await mutate(row, (r) => ({ state: { ...r.state, preview: p } }));
}

export { roundComplete };

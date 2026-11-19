import 'server-only';
import { randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { generateRound, newMixer, roundComplete, type GuestMixer } from '@/lib/mixer/guestMixer';
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
    rsvps: rs.filter((r) => r.status !== 'out').map(({ id, name, gender, level, level_num, status, is_host, created_at, team }) => ({ id, name, gender, level, level_num: level_num == null ? null : Number(level_num), status, is_host, created_at, team: team ?? null })),
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
  const open = Math.max(0, row.spots - inN);
  for (const w of waiting.slice(0, open)) await db.from('play_rsvps').update({ status: 'in' }).eq('id', w.id);
}

/** A newcomer during a live event joins the rotation from the next round. */
async function addToMixer(row: Row, p: { id: string; name: string; gender: 'male' | 'female' | null; team?: 'A' | 'B' | null }) {
  await mutate(row, (r) => {
    if (r.status !== 'live' || !r.state?.mixer) return null;
    const m = r.state.mixer;
    if (m.players.some((x) => x.id === p.id && !x.out)) return null;
    const players = m.players.some((x) => x.id === p.id)
      ? m.players.map((x) => (x.id === p.id ? { ...x, out: false } : x))
      : [...m.players, { id: p.id, name: p.name, ...(p.gender ? { gender: p.gender } : {}), ...(p.team ? { team: p.team } : {}) }];
    return { state: { ...r.state, mixer: { ...m, players } } };
  });
}

type Body = Record<string, unknown>;
const s = (v: unknown, n = 40) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const gender = (v: unknown) => (v === 'male' || v === 'female' ? v : null);

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
      const status = row.status === 'live' || inN < row.spots ? 'in' : 'wait';
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
      const { data, error } = await db.from('play_rsvps').insert({ event_id: row.id, name, gender: gender(body.gender), level: levelText, level_num, player_key: pk, status, team }).select('id').single();
      if (error) throw new PlayError(error.message, 500);
      if (row.status === 'live') await addToMixer(row, { id: data.id, name, gender: gender(body.gender), team });
      if (row.status === 'open' && status === 'in') await hype(c, { id: data.id, name }).catch(() => {});
      return { playerKey: pk };
    }
    case 'leave': {
      if (!mine) throw new PlayError('You are not on this one.');
      await db.from('play_rsvps').update({ status: 'out' }).eq('id', mine.id);
      if (row.status === 'open') { await promoteWaitlist(row); await nearbyNeedOne(row.code).catch(() => {}); }
      if (row.status === 'live') await mutate(row, (r) => r.state?.mixer ? { state: { ...r.state, mixer: { ...r.state.mixer, players: r.state.mixer.players.map((p) => p.id === mine.id ? { ...p, out: true } : p) } } } : null);
      return {};
    }
    case 'add': { // walk-ups, pasted lists: host only
      hostOnly();
      const names = String(body.names ?? '').split(/[\n,;]+/).map((x) => x.replace(/^\s*\d+[.)]\s*/, '').trim().slice(0, 40)).filter(Boolean).slice(0, 60);
      const have = new Set(rs.filter((r) => r.status !== 'out').map((r) => r.name.toLowerCase()));
      for (const name of names) {
        if (have.has(name.toLowerCase())) continue; have.add(name.toLowerCase());
        const { data } = await db.from('play_rsvps').insert({ event_id: row.id, name, player_key: newKey(), status: 'in' }).select('id').single();
        if (data && row.status === 'live') await addToMixer((await loadRow(c))!, { id: data.id, name, gender: null });
      }
      if (row.status === 'open') {
        const n = (await loadRsvps(row.id)).filter((r) => r.status === 'in').length;
        if (n > row.spots) await mutate(row, () => ({ spots: Math.min(96, n) }));
      }
      return {};
    }
    case 'remove': {
      hostOnly();
      const id = s(body.id, 60);
      await db.from('play_rsvps').update({ status: 'out' }).eq('id', id).eq('event_id', row.id);
      if (row.status === 'open') await nearbyNeedOne(row.code).catch(() => {});
      if (row.status === 'live') await mutate(row, (r) => r.state?.mixer ? { state: { ...r.state, mixer: { ...r.state.mixer, players: r.state.mixer.players.map((p) => p.id === id ? { ...p, out: true } : p) } } } : null);
      else await promoteWaitlist(row);
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
      await mutate(row, (r) => ({ ...d, state: r.state?.mixer ? { ...r.state, mixer: { ...r.state.mixer, courts: d.courts, format: r.status === 'live' ? r.state.mixer.format : d.format, name: d.title } } : r.state }));
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
      if (row.format === 'team-battle') { // anyone without a side goes to the smaller team
        const ins = rs.filter((r) => r.status === 'in');
        for (const r of ins.filter((x) => !x.team)) {
          const t = ins.filter((x) => x.team === 'A').length <= ins.filter((x) => x.team === 'B').length ? 'A' : 'B';
          r.team = t; await db.from('play_rsvps').update({ team: t }).eq('id', r.id);
        }
      }
      const players = rs.filter((r) => r.status === 'in').map((r) => ({ id: r.id, name: r.name, ...(r.gender ? { gender: r.gender } : {}), ...(r.team ? { team: r.team } : {}) }));
      await mutate(row, (r) => {
        const m: GuestMixer = { ...newMixer(), name: r.title, courts: r.courts, format: r.format, players, rounds: [] };
        m.rounds = [generateRound(m)];
        return { status: 'live', state: { ...r.state, mixer: m, roundStartedAt: new Date().toISOString() } };
      });
      return {};
    }
    case 'next':
    case 'reshuffle': {
      hostOnly();
      await mutate(row, (r) => {
        const m = mixerOf(r);
        const replace = action === 'reshuffle' && m.rounds.length > 0;
        const round = generateRound(m, { replaceLast: replace });
        const rounds = replace ? [...m.rounds.slice(0, -1), round] : [...m.rounds, round];
        return { state: { ...r.state, mixer: { ...m, rounds }, roundStartedAt: new Date().toISOString() } };
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
      const num = (v: unknown) => (v === null || v === '' || v === undefined ? null : Math.min(99, Math.max(0, Math.round(Number(v)))));
      const a = num(body.a), b = num(body.b);
      await mutate(row, (r) => {
        const m = r.state?.mixer; if (!m) throw new PlayError('Not started yet.');
        const rounds = m.rounds.map((x) => x.number !== rn ? x : { ...x, matches: x.matches.map((y) => y.court !== ct ? y : { ...y, scoreA: a, scoreB: b }) });
        return { state: { ...r.state, mixer: { ...m, rounds } } };
      });
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
  const ev = { title: row.title, when: whenLine(row, 'America/Los_Angeles'), location: row.location, level: row.level, spots: row.spots, sport: row.sport, format: FORMAT_NAME[row.format as keyof typeof FORMAT_NAME] ?? row.format };
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

/**
 * The self-running demo at /play/demo: a whole Friday night, played in the
 * visitor's browser. Same pairing engine, same parser, same awards as a real
 * game. No database, no AI calls, no rows: every visitor gets their own night.
 *
 * This module is pure (no React, no DOM). The tour drives it with the same
 * actions the real API takes, so the real screens render it unchanged.
 */
import { generateRound, newMixer, standings, type GuestMixer } from '@/lib/mixer/guestMixer';
import { awards, normalizeDraft, type PlayDraft, type PlayEvent, type PlayRsvp } from '@/lib/play/core';

export const DEMO_BRAND = 'TennisIRL';
export const DEMO_SENTENCE = 'Friday night mixer 6pm at Lakeside Park, 3 courts, 12 players, 3.5–4.0';
export const DEMO_TITLE = 'Friday Night Mixer';
export const HOST = 'Jordan P';
export const ME = 'Maya L';

/** The crew, in the order they tap in. Ratings only steer the simulated scores. */
export const CREW: { name: string; skill: number; hype: string }[] = [
  { name: 'Jordan P', skill: 3.9, hype: 'Booked the courts, built the night, and fully plans to win it.' },
  { name: 'Priya S', skill: 4.0, hype: 'First to tap in. Read into that what you will.' },
  { name: 'Marcus W', skill: 3.8, hype: 'Big serve, bigger opinions on line calls.' },
  { name: 'Dev K', skill: 4.1, hype: 'Has not missed a Friday since March. Has not lost many either.' },
  { name: 'Elena R', skill: 3.9, hype: 'Lives at the net. Pays rent there.' },
  { name: 'Maya L', skill: 4.2, hype: 'Lefty slice that ends friendships. Bring a towel.' },
  { name: 'Chris T', skill: 3.6, hype: 'Claims to be “just here for the exercise.” Nobody believes it.' },
  { name: 'Sofia M', skill: 3.8, hype: 'Topspin lob specialist. Look up at your own risk.' },
  { name: 'Tom B', skill: 3.5, hype: 'Brings the good balls. Takes them home too.' },
  { name: 'Aisha J', skill: 4.0, hype: 'Quiet warm-up. Loud forehand.' },
  { name: 'Ben H', skill: 3.7, hype: 'Tapped in last. Plays like the shot clock is running.' },
  { name: 'Lauren G', skill: 3.9, hype: 'Back from two weeks off and extremely well rested.' },
];
const skillOf = (name: string) => CREW.find((c) => c.name === name)?.skill ?? 3.8;
const first = (n: string) => n.split(' ')[0];

/** A seeded RNG so the same night plays out the same way, every visit. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Next Friday at 6pm local, as the host would have typed it. */
export function nextFriday(now = new Date(), weeks = 0) {
  const d = new Date(now);
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7) + weeks * 7);
  d.setHours(18, 0, 0, 0);
  return d;
}

export function demoDraft(now = new Date()): PlayDraft {
  return normalizeDraft({
    title: DEMO_TITLE, sport: 'tennis', kind: 'social', format: 'maximize-courts',
    when_text: 'Friday 6pm', starts_at: nextFriday(now).toISOString(), location: 'Lakeside Park', level: '3.5–4.0',
    spots: 12, courts: 3, round_minutes: 20,
    notes: `Players: ${CREW.map((c) => first(c.name)).join(', ')}`,
  });
}

export function makeEvent(d: PlayDraft, code = 'demo'): PlayEvent {
  return { ...d, code, host_name: HOST, status: 'open', state: {}, version: 1, created_at: new Date().toISOString(), rsvps: [], isHost: false, me: null };
}

let n = 0;
const rid = () => `d${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ---------------- the reducer: the same actions /api/p/<code> takes ---------------- */
export type Act = Record<string, unknown> & { action: string };
export interface Applied { e: PlayEvent; id?: string }

export function apply(e0: PlayEvent, b: Act, seed = 7): Applied {
  const e: PlayEvent = structuredClone(e0);
  const ins = () => e.rsvps.filter((r) => r.status === 'in');
  const add = (name: string, host = false): string => {
    const have = e.rsvps.find((r) => r.name.toLowerCase() === name.toLowerCase() && r.status !== 'out');
    if (have) return have.id;
    const r: PlayRsvp = { id: rid(), name, gender: null, level: null, team: null, status: ins().length >= e.spots && e.status === 'open' ? 'wait' : 'in', is_host: host, created_at: new Date().toISOString() };
    e.rsvps.push(r);
    if (e.status === 'live' && e.state.mixer && r.status === 'in') e.state.mixer.players.push({ id: r.id, name });
    return r.id;
  };
  const m = e.state.mixer;
  switch (b.action) {
    case 'join': return { e, id: add(String(b.name), !!b.host) };
    case 'add': String(b.names ?? '').split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).forEach((x) => add(x)); break;
    case 'leave': case 'remove': {
      const r = e.rsvps.find((x) => x.id === b.id); if (r) r.status = 'out';
      const w = e.rsvps.find((x) => x.status === 'wait'); if (w && ins().length < e.spots) w.status = 'in';
      break;
    }
    case 'hype': {
      const lines = ins().map((r) => ({ id: r.id, name: r.name, line: CREW.find((c) => c.name === r.name)?.hype ?? 'New face. Unknown forehand. Dangerous combination.' }));
      e.state.preview = { headline: 'Friday night at Lakeside: nobody came here to lose', lines, at: new Date().toISOString() };
      break;
    }
    case 'courts': e.courts = Math.min(24, Math.max(1, Number(b.courts))); if (m) m.courts = e.courts; break;
    case 'start': {
      const mx: GuestMixer = { ...newMixer(), name: e.title, courts: e.courts, format: e.format, players: ins().map((r) => ({ id: r.id, name: r.name })), rounds: [] };
      mx.rounds = [generateRound(mx, { seed })];
      e.status = 'live'; e.state = { ...e.state, mixer: mx, roundStartedAt: new Date().toISOString() };
      break;
    }
    case 'next': case 'reshuffle': {
      if (!m) break;
      const replace = b.action === 'reshuffle';
      const r = generateRound(m, { seed: seed + m.rounds.length * 31, replaceLast: replace });
      m.rounds = replace ? [...m.rounds.slice(0, -1), r] : [...m.rounds, r];
      e.state.roundStartedAt = new Date().toISOString();
      break;
    }
    case 'score': {
      const x = m?.rounds.find((r) => r.number === Number(b.round))?.matches.find((y) => y.court === Number(b.court));
      if (x) { x.scoreA = b.a == null ? null : Number(b.a); x.scoreB = b.b == null ? null : Number(b.b); }
      break;
    }
    case 'end': {
      e.status = 'done';
      if (m) m.rounds = m.rounds.filter((x, i, all) => i < all.length - 1 || x.matches.some((y) => y.scoreA != null));
      break;
    }
    case 'reopen': e.status = m ? 'live' : 'open'; break;
    case 'recap': if (m) e.state.recap = callTheGame(e, (b.spice as 'mild' | 'club' | 'locker') ?? 'club'); break;
    case 'recap_me': {
      const l = e.state.recap?.lines.find((x) => x.id === b.me);
      if (l) { if (b.mode === 'skip') l.skipped = true; else if (b.mode === 'show') l.skipped = false; else l.line = soften(l.line); }
      break;
    }
    default: break; // watch, team, gender, teamnames: nothing to do in a demo
  }
  e.version++;
  return { e };
}

/** Simulated, believable timed-round scores: the stronger pair usually wins, sometimes it's 7–6. */
export function simScore(e: PlayEvent, teamA: string[], teamB: string[], r: () => number): [number, number] {
  const nm = (id: string) => e.state.mixer?.players.find((p) => p.id === id)?.name ?? '';
  const sa = teamA.reduce((s, id) => s + skillOf(nm(id)), 0), sb = teamB.reduce((s, id) => s + skillOf(nm(id)), 0);
  const pA = 1 / (1 + Math.exp(-(sa - sb) * 2.2));
  const aWins = r() < pA;
  const close = r();
  const lose = close < 0.22 ? 6 : close < 0.5 ? 4 : close < 0.8 ? 3 : 2;
  const win = lose === 6 ? 7 : 6;
  return aWins ? [win, lose] : [lose, win];
}

/* ---------------- "Call the game": written from the real scores ---------------- */
const pick = <T,>(a: T[], i: number) => a[i % a.length];

function callTheGame(e: PlayEvent, spice: 'mild' | 'club' | 'locker'): NonNullable<PlayEvent['state']['recap']> {
  const m = e.state.mixer!;
  const st = standings(m);
  const aw = awards(m);
  const byName = (w: string) => aw.find((a) => a.title === w);
  const champ = st[0];
  const wall = byName('The Wall'), most = byName('Most games won'), duo = byName('Best duo'), nail = byName('Nail-biter');
  const rounds = m.rounds.length;
  const headline = champ.losses === 0 ? `${first(champ.name)} runs the table at Lakeside` : `${first(champ.name)} survives a Friday-night scramble`;
  const story = [
    `${m.players.length} players, ${e.courts} courts, ${rounds} rounds and not one clipboard.`,
    `${champ.name} went ${champ.wins}–${champ.losses} and took the night on ${champ.gamesFor} games.`,
    wall ? `${wall.who} was a brick wall: ${wall.why}.` : '',
    nail ? `The nail-biter belonged to ${nail.who}, who ${nail.why}. Half the courts stopped to watch.` : duo ? `Best duo: ${duo.who}, who ${duo.why}.` : '',
    spice === 'locker' ? 'Somebody owes somebody a beer. You know who you are.' : 'Same time next Friday?',
  ].filter(Boolean).join(' ');

  const W = {
    champ: ['Went {w}–{l} and never once checked the scoreboard. Did not need to.', 'Took the night {w}–{l}. Everyone else is playing for second until further notice.'],
    perfect: ['Did not drop a round. Somebody check the strings for a motor.', 'Undefeated and somehow still apologizing on every winner.'],
    wall: ['Gave up {ga} games a round. Opponents started aiming at the fence instead.'],
    most: ['Won {gf} games. Volume dealer, no refunds.'],
    good: ['Won {w} of {p}. The record that gets you picked first next week.', '{w}–{l} with one serve that is still in orbit.', 'Quietly went {w}–{l}. Loudly reminded everyone about it.', '{w}–{l} and {gf} games. Somebody is getting a sandbagging text tonight.'],
    even: ['One big win, one near miss, and the best celebration on the property.', 'Split the night {w}–{l}. Peak Friday energy, zero regrets.'],
    low: ['{w}–{l} on paper. On vibes, undefeated. Revenge tour starts next Friday.', 'Hit the shot of the night in a loss, and that is the part everyone will remember.', 'Took {gf} games off people who will not admit how close it was.', 'Went {w}–{l} and still won the warm-up. That counts for something.', 'Drew the toughest partners-and-opponents draw of the night and kept swinging.', 'Already asked who is in next week. That is the spirit.', 'The record says {w}–{l}. The highlight reel says otherwise.'],
  };
  const fill = (t: string, s: (typeof st)[0]) => t.replace('{w}', String(s.wins)).replace('{l}', String(s.losses)).replace('{p}', String(s.played))
    .replace('{gf}', String(s.gamesFor)).replace('{ga}', (s.gamesAgainst / Math.max(1, s.played)).toFixed(1));
  let gi = 0, ei = 0, li = 0;
  const lines = st.map((s, i) => {
    let tag: string, line: string;
    if (i === 0) { tag = 'Champion'; line = fill(pick(W.champ, s.losses), s); }
    else if (wall?.who === s.name) { tag = 'The Wall'; line = fill(W.wall[0], s); }
    else if (most?.who === s.name) { tag = 'Most games won'; line = fill(W.most[0], s); }
    else if (s.losses === 0) { tag = 'Undefeated'; line = fill(pick(W.perfect, gi++), s); }
    else if (s.wins > s.losses) { tag = pick(['Closer', 'Problem', 'Sleeper pick', 'Sandbagger?'], gi); line = fill(pick(W.good, gi++), s); }
    else if (s.wins === s.losses) { tag = pick(['Split decision', 'Chaos agent'], ei); line = fill(pick(W.even, ei++), s); }
    else { tag = pick(['Revenge tour', 'Shot of the night', 'Closer than it looks', 'Warm-up champ', 'Character builder', 'Already in', 'Highlight reel'], li); line = fill(pick(W.low, li++), s); }
    if (s.name === HOST) line += ' Also ran the whole night from one phone.';
    return { id: s.id, name: s.name, tag, line };
  });
  return { headline, story, spice, crown: null, at: new Date().toISOString(), lines };
}

const soften = (l: string) => (/Revenge|angry|orbit|motor/.test(l) ? 'Great tennis, great company, and a forehand that is coming around fast.' : l.replace('Loudly reminded everyone about it.', 'Classy about it, too.'));

/** Who in a round is on the court with this player, for the "You're on Court 2" alert. */
export function courtOf(e: PlayEvent, id: string | null) {
  const r = e.state.mixer?.rounds.at(-1);
  return r?.matches.find((x) => id && [...x.teamA, ...x.teamB].includes(id)) ?? null;
}

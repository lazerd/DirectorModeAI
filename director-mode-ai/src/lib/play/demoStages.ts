/**
 * The landing page's "See it in action": one small game, Friday Night Doubles
 * (8 players, 2 courts), frozen at the moments a visitor needs to see.
 *
 * Every stage is produced by the same demo engine as the full tour (lib/play/demo),
 * which runs the real pairing engine with the same actions /api/p/<code> takes.
 * Nothing here is drawn by hand, so the landing page can only show what the
 * product really does.
 */
import { normalizeDraft, type PlayEvent } from '@/lib/play/core';
import { CREW, DEMO_SPORTS, HOST, ME, apply, demoDraft, makeEvent, rng, type Act, type DemoSport } from '@/lib/play/demo';

export const STAGE_TITLE = 'Friday Night Doubles';
export const STAGE_PLAYERS = 8;
export const STAGE_COURTS = 2;

/** The eight who play, host first. Maya is the player whose phone we follow. */
export const STAGE_CREW = [HOST, 'Priya S', 'Marcus W', 'Dev K', ME, 'Elena R', 'Chris T', 'Sofia M'] as const;

export interface Stages {
  /** Just created: the host is in, the link is ready to share. */
  created: PlayEvent;
  /** The link is in the group chat and people are tapping in. */
  filling: PlayEvent;
  /** Every spot taken. */
  full: PlayEvent;
  /** The host tapped Start: round 1, every player on a court. */
  live: PlayEvent;
  /** Round 1 scores are in, standings moved, round 2 is drawn. */
  next: PlayEvent;
  hostId: string;
  mayaId: string;
}

const first = (n: string) => n.split(' ')[0];

export function buildStages(now = new Date(), sport: DemoSport = 'tennis'): Stages {
  // The real pairing engine breaks ties with Math.random even when seeded. For this one
  // scripted scene, borrow a seeded source while it builds, so every visitor (and the hero
  // and the walkthrough) sees the same courts. The real app is untouched.
  const real = Math.random;
  Math.random = rng(20261122);
  try { return build(now, sport); } finally { Math.random = real; }
}

function build(now: Date, sport: DemoSport): Stages {
  const K = DEMO_SPORTS[sport];
  const draft = normalizeDraft({
    ...demoDraft(now, sport),
    title: STAGE_TITLE,
    format: 'maximize-courts',
    spots: STAGE_PLAYERS,
    courts: STAGE_COURTS,
    notes: `Players: ${STAGE_CREW.map(first).join(', ')}`,
  });
  let e = makeEvent(draft);
  let hostId = '', mayaId = '';
  const run = (b: Act) => { const r = apply(e, b); e = r.e; return r.id; };
  // Fixed ids: the pairing engine is seeded, so the same ids give the same courts on every visit.
  const join = (name: string) => run({ action: 'join', name, host: name === HOST, id: `p-${first(name).toLowerCase()}` })!;

  hostId = join(HOST);
  const created = e;

  for (const n of STAGE_CREW.slice(1, 5)) { const id = join(n); if (n === ME) mayaId = id; }
  run({ action: 'hype' });
  const filling = e;

  for (const n of STAGE_CREW.slice(5)) join(n);
  run({ action: 'hype' });
  const full = e;

  run({ action: 'start' });
  const live = e;

  // Round 1 scores: deterministic, believable for the sport (games to 11 in pickleball).
  const r1 = e.state.mixer!.rounds.at(-1)!;
  const skill = (id: string) => CREW.find((c) => c.name === e.state.mixer!.players.find((p) => p.id === id)?.name)?.skill ?? 3.8;
  for (const m of r1.matches) {
    const aWins = m.teamA.reduce((s, id) => s + skill(id), 0) >= m.teamB.reduce((s, id) => s + skill(id), 0);
    const [w, l] = [K.win, sport === 'pickleball' ? 7 : 4];
    run({ action: 'score', round: r1.number, court: m.court, a: aWins ? w : l, b: aWins ? l : w });
  }
  run({ action: 'next' });
  const next = e;

  return { created, filling, full, live, next, hostId, mayaId };
}

/** One game per sport per page: the hero and the walkthrough show the same night. */
const cache = new Map<DemoSport, Stages>();
export function stagesFor(sport: DemoSport = 'tennis'): Stages {
  let s = cache.get(sport);
  if (!s) { s = buildStages(new Date(), sport); cache.set(sport, s); }
  return s;
}

/** The event as one phone sees it: the host's, or Maya's. */
export function viewAs(e: PlayEvent, me: string | null, isHost: boolean): PlayEvent {
  return { ...e, me, isHost };
}

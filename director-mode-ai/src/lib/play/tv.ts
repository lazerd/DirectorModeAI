/**
 * The TV / projector board at /p/<code>/tv: pure helpers (no React, no DOM) so
 * what the board says out loud is testable.
 */
import { courtLabel, type GuestMixer, type GuestRound, type Standing } from '@/lib/mixer/guestMixer';
import { courtName, standingsFor, type Draw } from './draw';

export const TIME_UP_TEXT = 'Time. Finish your point and enter your scores.';

/** "Ann", "Ann and Bo", "Ann, Bo and Cy". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What the board says when a round goes up:
 * "Round 3. Court 5: Ann and Bo versus Cy and Di. Court 6: Ed versus Flo. Sitting out: Gus."
 */
export function roundAnnouncement(m: Pick<GuestMixer, 'players' | 'courtLabels'>, round: GuestRound): string {
  const name = (id: string) => m.players.find((p) => p.id === id)?.name ?? 'someone';
  const parts = [`Round ${round.number}.`];
  for (const x of [...round.matches].sort((a, b) => a.court - b.court)) {
    parts.push(`Court ${courtLabel(m, x.court)}: ${joinNames(x.teamA.map(name))} versus ${joinNames(x.teamB.map(name))}.`);
  }
  if (round.sittingOut.length) parts.push(`Sitting out: ${joinNames(round.sittingOut.map(name))}.`);
  return parts.join(' ');
}

/** Big clock text: "12:05", "0:09", or "Time!" once it runs out. Empty when there's no clock. */
export function clockText(leftMs: number | null): string {
  if (leftMs == null) return '';
  if (leftMs <= 0) return 'Time!';
  const s = Math.ceil(leftMs / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ms left on the round clock; a paused clock stands still at the pause moment. */
export function clockLeft(startIso: string | null | undefined, minutes: number, pausedIso: string | null | undefined, now: number): number | null {
  if (!startIso) return null;
  const at = pausedIso ? Date.parse(pausedIso) : now;
  return Date.parse(startIso) + minutes * 60e3 - at;
}

/**
 * Should the board call "Time" now? Only on the tick where a running clock
 * crosses zero while someone is watching (not on load, not while paused).
 */
export function crossedZero(prevLeft: number | null, left: number | null, paused: boolean): boolean {
  return !paused && prevLeft != null && left != null && prevLeft > 0 && left <= 0;
}

/** Poll every 5s while live, 15s otherwise. The board never stops polling. */
export const pollMs = (status: string) => (status === 'live' ? 5000 : 15000);

/**
 * Tournament board: what to call out when matches go on court since the last look.
 * "Court 5: Ann versus Bo. Court 6: Cy and Di versus Ed and Flo." Empty when nothing new.
 */
export function drawCallout(d: Draw, prevOnCourt: Set<string>): string {
  const fresh = d.matches.filter((m) => m.status === 'on_court' && !prevOnCourt.has(m.key)).sort((a, b) => (a.court ?? 0) - (b.court ?? 0));
  const side = (id: string | null) => joinNames(d.entries.find((e) => e.id === id)?.players ?? ['someone']);
  return fresh.map((m) => `Court ${courtName(d, m.court ?? 0)}: ${side(m.player1_id)} versus ${side(m.player3_id)}.`).join(' ');
}

/** The board's leaderboard rows for a draw (same shape as the mixer's standings). */
export function drawBoardRows(d: Draw): Standing[] {
  return standingsFor(d).map((s) => ({ id: s.id, name: s.name, played: s.played, wins: s.wins, losses: s.losses, gamesFor: s.gamesWon, gamesAgainst: s.gamesLost, rank: s.played ? String(s.rank) : '–' }));
}

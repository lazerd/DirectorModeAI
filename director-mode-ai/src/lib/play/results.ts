/**
 * Read-only results for /p/<code>: the CSV export and the bits the print sheet
 * and results image share. Pure (no DB), so it is testable and safe anywhere.
 */
import { courtLabel, standings, winnerOf, type GuestMixer } from '@/lib/mixer/guestMixer';

const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const line = (xs: unknown[]) => xs.map(cell).join(',');

export function winPct(wins: number, played: number): string {
  return played ? `${Math.round((wins / played) * 1000) / 10}%` : '';
}

/** Standings, a blank line, then every match. Matches MixerMode's "Export CSV". */
export function resultsCsv(m: GuestMixer | null | undefined): string {
  const out: string[] = [line(['Rank', 'Player', 'Played', 'Wins', 'Losses', 'Games won', 'Games lost', 'Win %'])];
  if (m) for (const s of standings(m)) out.push(line([s.rank, s.name, s.played, s.wins, s.losses, s.gamesFor, s.gamesAgainst, winPct(s.wins, s.played)]));
  out.push('');
  out.push(line(['Round', 'Court', 'Side A', 'Side B', 'Score A', 'Score B', 'Tiebreak winner']));
  if (m) {
    const name = (id: string) => m.players.find((p) => p.id === id)?.name ?? '?';
    for (const r of m.rounds) for (const x of [...r.matches].sort((a, b) => a.court - b.court)) {
      const a = x.teamA.map(name).join(' & '), b = x.teamB.map(name).join(' & ');
      const w = x.scoreA != null && x.scoreA === x.scoreB ? winnerOf(x) : null; // only a tied score has a tiebreak
      out.push(line([r.number, courtLabel(m, x.court), a, b, x.scoreA ?? '', x.scoreB ?? '', w === 'A' ? a : w === 'B' ? b : '']));
    }
  }
  return out.join('\r\n') + '\r\n';
}

/** A filename-safe slug of the event title. */
export function fileSlug(title: string | null | undefined, code: string): string {
  const s = (title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
  return s || code;
}

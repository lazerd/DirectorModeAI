/**
 * Builds the "match-day results" email for a JTT (team-format) league on a
 * given date. Pure function — no DB, no Resend — so it can be unit-tested and
 * reused for both the in-app preview and the actual send.
 *
 * Sections:
 *   1. Day's results — every matchup played on the date, with the per-line
 *      player-by-player breakdown (singles + doubles, score + winner).
 *   2. Age-group winners — which club won each division on the date.
 *   3. Highlights — closest matches + sweeps/shutouts (the "anything else").
 *   4. League standings (season to date) — overall + per division.
 *   5. Individual ladders (season to date) — results-based, per division.
 *
 * Reuses computeDivisionStandings + computePlayerRecords from lib/jtt so the
 * numbers match the in-app Standings tab exactly.
 */
import {
  computeDivisionStandings,
  computePlayerRecords,
  type ClubStanding,
} from './jtt';

export type EmailClub = {
  id: string;
  name: string;
  short_code: string;
  color?: string | null;
};
export type EmailDivision = {
  id: string;
  name: string;
  short_code: string;
  sort_order?: number;
};
export type EmailDivisionClub = { division_id: string; club_id: string };
export type EmailRoster = {
  id: string;
  player_name: string;
  division_id: string;
  club_id: string;
};
export type EmailMatchup = {
  id: string;
  division_id: string;
  match_date: string;
  home_club_id: string;
  away_club_id: string;
  home_lines_won: number;
  away_lines_won: number;
  winner: 'home' | 'away' | 'tie' | null;
  status: string;
};
export type EmailLine = {
  id: string;
  matchup_id: string;
  line_type: 'singles' | 'doubles';
  line_number: number;
  home_player1_id: string | null;
  home_player2_id: string | null;
  away_player1_id: string | null;
  away_player2_id: string | null;
  score: string | null;
  winner: 'home' | 'away' | null;
  status: string;
};

export type JTTResultsEmailInput = {
  leagueName: string;
  date: string; // 'YYYY-MM-DD'
  clubs: EmailClub[];
  divisions: EmailDivision[];
  divisionClubs: EmailDivisionClub[];
  rosters: EmailRoster[];
  matchups: EmailMatchup[]; // all season
  lines: EmailLine[]; // all season
  /** Optional free-text note from the director, shown under the header. */
  note?: string | null;
};

export type JTTResultsEmail = {
  subject: string;
  html: string;
  text: string;
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** Format a 'YYYY-MM-DD' date string without timezone drift. */
export function formatPrettyDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[wd]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Distinct match dates that have at least one completed line, newest first. */
export function datesWithResults(
  matchups: EmailMatchup[],
  lines: EmailLine[]
): string[] {
  const completedMatchupIds = new Set(
    lines.filter(l => l.status === 'completed').map(l => l.matchup_id)
  );
  const dates = new Set<string>();
  for (const m of matchups) {
    if (completedMatchupIds.has(m.id)) dates.add(String(m.match_date).slice(0, 10));
  }
  return Array.from(dates).sort((a, b) => (a < b ? 1 : -1));
}

export function buildJTTResultsEmail(input: JTTResultsEmailInput): JTTResultsEmail {
  const { leagueName, date, clubs, divisions, divisionClubs, rosters, matchups, lines } = input;

  const clubById = new Map(clubs.map(c => [c.id, c]));
  const clubsByIdShort = new Map(clubs.map(c => [c.id, { short_code: c.short_code }]));
  const rosterById = new Map(rosters.map(r => [r.id, r]));
  const shortOf = (clubId: string) => clubById.get(clubId)?.short_code || '??';
  const nameOf = (clubId: string) => clubById.get(clubId)?.name || '??';

  const playerName = (id: string | null) =>
    id ? rosterById.get(id)?.player_name || 'Unknown' : '—';
  // For a line side: singles shows one name; doubles shows both slots (a missing
  // partner renders as "—" so an unassigned slot is obvious, not hidden).
  const sideNamesFor = (l: EmailLine, side: 'home' | 'away') => {
    const [p1, p2] =
      side === 'home'
        ? [l.home_player1_id, l.home_player2_id]
        : [l.away_player1_id, l.away_player2_id];
    return l.line_type === 'doubles'
      ? `${playerName(p1)} / ${playerName(p2)}`
      : playerName(p1);
  };

  const sortedDivisions = [...divisions].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );

  // ---- Day's matchups (any matchup on the date with ≥1 completed line) ----
  const dayMatchups = matchups
    .filter(m => String(m.match_date).slice(0, 10) === date)
    .filter(m => lines.some(l => l.matchup_id === m.id && l.status === 'completed'));

  const linesByMatchup = new Map<string, EmailLine[]>();
  for (const l of lines) {
    if (!linesByMatchup.has(l.matchup_id)) linesByMatchup.set(l.matchup_id, []);
    linesByMatchup.get(l.matchup_id)!.push(l);
  }

  // Collect highlights across the day.
  const closeMatches: string[] = [];
  const shutouts: string[] = [];

  type DayDivision = {
    division: EmailDivision;
    matchups: Array<{
      m: EmailMatchup;
      homeShort: string;
      awayShort: string;
      homeWon: number;
      awayWon: number;
      winnerLabel: string;
      lines: EmailLine[];
    }>;
  };
  const dayByDivision: DayDivision[] = [];
  for (const division of sortedDivisions) {
    const dms = dayMatchups.filter(m => m.division_id === division.id);
    if (dms.length === 0) continue;
    const entry: DayDivision = { division, matchups: [] };
    for (const m of dms) {
      const ls = (linesByMatchup.get(m.id) || [])
        .filter(l => l.status === 'completed')
        .sort((a, b) => a.line_number - b.line_number);
      const homeWon = ls.filter(l => l.winner === 'home').length;
      const awayWon = ls.filter(l => l.winner === 'away').length;
      const homeShort = shortOf(m.home_club_id);
      const awayShort = shortOf(m.away_club_id);
      const winnerLabel =
        homeWon > awayWon
          ? `${shortOf(m.home_club_id)} def. ${shortOf(m.away_club_id)} ${homeWon}–${awayWon}`
          : awayWon > homeWon
          ? `${shortOf(m.away_club_id)} def. ${shortOf(m.home_club_id)} ${awayWon}–${homeWon}`
          : `${homeShort} tied ${awayShort} ${homeWon}–${awayWon}`;
      entry.matchups.push({ m, homeShort, awayShort, homeWon, awayWon, winnerLabel, lines: ls });

      // Highlights: shutouts + close lines (tiebreak or 1-game margins).
      if (ls.length > 0 && (homeWon === 0 || awayWon === 0)) {
        const winS = homeWon === 0 ? awayShort : homeShort;
        const loseS = homeWon === 0 ? homeShort : awayShort;
        shutouts.push(`${winS} swept ${loseS} ${Math.max(homeWon, awayWon)}–0 (${division.short_code})`);
      }
      for (const l of ls) {
        const parsed = parseMargin(l.score);
        if (parsed !== null && parsed <= 1) {
          const wSide = l.winner === 'home' ? sideNamesFor(l, 'home') : sideNamesFor(l, 'away');
          const lSide = l.winner === 'home' ? sideNamesFor(l, 'away') : sideNamesFor(l, 'home');
          closeMatches.push(`${division.short_code} ${l.line_type}: ${esc(wSide)} edged ${esc(lSide)} ${esc(l.score || '')}`);
        }
      }
    }
    dayByDivision.push(entry);
  }

  // ---- Season standings (overall + per division) ----
  const clubsById = clubsByIdShort;
  const perDivisionStandings = sortedDivisions.map(division => {
    const divClubs = divisionClubs
      .filter(dc => dc.division_id === division.id)
      .map(dc => clubById.get(dc.club_id))
      .filter((c): c is EmailClub => !!c);
    const divMatchups = matchups.filter(m => m.division_id === division.id);
    const standings = computeDivisionStandings(divClubs, divMatchups);
    const divLines = lines.filter(l => divMatchups.some(m => m.id === l.matchup_id));
    const divRosters = rosters.filter(r => r.division_id === division.id);
    const playerRecords = computePlayerRecords(divRosters, clubsById, divLines);
    return { division, standings, playerRecords };
  });

  const overall = (() => {
    const map = new Map<string, ClubStanding>();
    for (const { standings } of perDivisionStandings) {
      for (const s of standings) {
        const ex = map.get(s.club_id);
        if (ex) {
          ex.matchups_played += s.matchups_played;
          ex.matchups_won += s.matchups_won;
          ex.matchups_lost += s.matchups_lost;
          ex.matchups_tied += s.matchups_tied;
          ex.lines_won += s.lines_won;
          ex.lines_lost += s.lines_lost;
          ex.points += s.points;
        } else {
          map.set(s.club_id, { ...s });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      return (b.lines_won - b.lines_lost) - (a.lines_won - a.lines_lost);
    });
  })();

  const prettyDate = formatPrettyDate(date);
  const subject = `${leagueName} — Results for ${MONTHS[Number(date.split('-')[1]) - 1]} ${Number(date.split('-')[2])}`;

  // ============================ HTML ============================
  const styles = {
    wrap: 'max-width:640px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;',
    h1: 'font-size:20px;font-weight:700;margin:0 0 4px;color:#111827;',
    sub: 'font-size:14px;color:#6b7280;margin:0 0 20px;',
    h2: 'font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#c2410c;margin:28px 0 10px;border-bottom:2px solid #fed7aa;padding-bottom:6px;',
    h3: 'font-size:14px;font-weight:700;color:#111827;margin:16px 0 6px;',
    card: 'border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;margin:0 0 12px;background:#fff;',
    win: 'font-weight:700;color:#15803d;',
    table: 'width:100%;border-collapse:collapse;font-size:13px;',
    th: 'text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;border-bottom:1px solid #e5e7eb;padding:6px 8px;',
    td: 'padding:6px 8px;border-bottom:1px solid #f3f4f6;',
  };

  const lineRowHtml = (l: EmailLine) => {
    const home = sideNamesFor(l, 'home') || '—';
    const away = sideNamesFor(l, 'away') || '—';
    const homeWin = l.winner === 'home';
    const awayWin = l.winner === 'away';
    return `<tr>
      <td style="${styles.td}color:#9ca3af;text-transform:capitalize;">${l.line_type} ${l.line_number}</td>
      <td style="${styles.td}${homeWin ? styles.win : ''}">${esc(home)}${homeWin ? ' ✓' : ''}</td>
      <td style="${styles.td}color:#9ca3af;text-align:center;">vs</td>
      <td style="${styles.td}${awayWin ? styles.win : ''}">${esc(away)}${awayWin ? ' ✓' : ''}</td>
      <td style="${styles.td}text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;">${esc(l.score || '')}</td>
    </tr>`;
  };

  const dayHtml = dayByDivision.length === 0
    ? `<p style="color:#6b7280;font-size:14px;">No completed results recorded for ${esc(prettyDate)}.</p>`
    : dayByDivision.map(({ division, matchups: dms }) => `
      <div style="${styles.card}">
        <div style="${styles.h3}">${esc(division.name)}</div>
        ${dms.map(dm => `
          <div style="font-size:14px;margin:8px 0 4px;"><span style="${styles.win}">${esc(dm.winnerLabel)}</span>
            <span style="color:#9ca3af;"> &nbsp;(${esc(dm.awayShort)} @ ${esc(dm.homeShort)})</span></div>
          <table style="${styles.table}">
            <tr><th style="${styles.th}">Line</th><th style="${styles.th}">${esc(dm.homeShort)} (home)</th><th style="${styles.th}"></th><th style="${styles.th}">${esc(dm.awayShort)} (away)</th><th style="${styles.th}text-align:right;">Score</th></tr>
            ${dm.lines.map(lineRowHtml).join('')}
          </table>
        `).join('')}
      </div>`).join('');

  // Age-group winners summary
  const ageGroupHtml = dayByDivision.length === 0 ? '' : `
    <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;">
      ${dayByDivision.flatMap(({ division, matchups: dms }) =>
        dms.map(dm => `<li><strong>${esc(division.short_code)}:</strong> ${esc(dm.winnerLabel)}</li>`)
      ).join('')}
    </ul>`;

  const highlightsItems = [...shutouts.map(s => `🎾 ${esc(s)}`), ...closeMatches.map(c => `🔥 Nailbiter — ${c}`)];
  const highlightsHtml = highlightsItems.length === 0 ? '' : `
    <h2 style="${styles.h2}">Highlights</h2>
    <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7;">
      ${highlightsItems.map(h => `<li>${h}</li>`).join('')}
    </ul>`;

  const standingsTableHtml = (rows: ClubStanding[], showDiff: boolean) => `
    <table style="${styles.table}">
      <tr>
        <th style="${styles.th}">#</th><th style="${styles.th}">Club</th>
        <th style="${styles.th}text-align:center;">GP</th>
        <th style="${styles.th}text-align:center;">W</th>
        <th style="${styles.th}text-align:center;">L</th>
        <th style="${styles.th}text-align:center;">T</th>
        <th style="${styles.th}text-align:center;">Lines</th>
        ${showDiff ? `<th style="${styles.th}text-align:center;">Diff</th>` : ''}
        <th style="${styles.th}text-align:right;">Pts</th>
      </tr>
      ${rows.map((s, i) => `<tr${i === 0 ? ' style="background:#fffbeb;"' : ''}>
        <td style="${styles.td}color:#9ca3af;">${i + 1}</td>
        <td style="${styles.td}font-weight:600;">${esc(s.club_name)}</td>
        <td style="${styles.td}text-align:center;">${s.matchups_played}</td>
        <td style="${styles.td}text-align:center;">${s.matchups_won}</td>
        <td style="${styles.td}text-align:center;">${s.matchups_lost}</td>
        <td style="${styles.td}text-align:center;">${s.matchups_tied}</td>
        <td style="${styles.td}text-align:center;">${s.lines_won}–${s.lines_lost}</td>
        ${showDiff ? `<td style="${styles.td}text-align:center;">${s.lines_won - s.lines_lost > 0 ? '+' : ''}${s.lines_won - s.lines_lost}</td>` : ''}
        <td style="${styles.td}text-align:right;font-weight:700;">${s.points}</td>
      </tr>`).join('')}
    </table>`;

  const laddersHtml = perDivisionStandings.map(({ division, standings, playerRecords }) => `
    <div style="${styles.card}">
      <div style="${styles.h3}">${esc(division.name)}</div>
      ${standingsTableHtml(standings, false)}
      ${playerRecords.filter(p => p.total_wins + p.total_losses > 0).length > 0 ? `
        <div style="font-size:12px;text-transform:uppercase;color:#6b7280;margin:14px 0 4px;letter-spacing:.04em;">Individual Ladder</div>
        <table style="${styles.table}">
          <tr><th style="${styles.th}">#</th><th style="${styles.th}">Player</th><th style="${styles.th}">Club</th>
          <th style="${styles.th}text-align:center;">Singles</th><th style="${styles.th}text-align:center;">Doubles</th>
          <th style="${styles.th}text-align:center;">Total</th><th style="${styles.th}text-align:right;">Win %</th></tr>
          ${playerRecords.filter(p => p.total_wins + p.total_losses > 0).map((p, i) => `<tr>
            <td style="${styles.td}color:#9ca3af;">${i + 1}</td>
            <td style="${styles.td}">${esc(p.player_name)}</td>
            <td style="${styles.td}color:#6b7280;">${esc(p.club_short)}</td>
            <td style="${styles.td}text-align:center;">${p.singles_wins}–${p.singles_losses}</td>
            <td style="${styles.td}text-align:center;">${p.doubles_wins}–${p.doubles_losses}</td>
            <td style="${styles.td}text-align:center;font-weight:600;">${p.total_wins}–${p.total_losses}</td>
            <td style="${styles.td}text-align:right;">${Math.round(p.winPct * 100)}%</td>
          </tr>`).join('')}
        </table>` : ''}
    </div>`).join('');

  const noteHtml = input.note?.trim()
    ? `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 12px;font-size:14px;margin:0 0 18px;">${esc(input.note.trim()).replace(/\n/g, '<br>')}</div>`
    : '';

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f9fafb;padding:24px 12px;">
    <div style="${styles.wrap}">
      <h1 style="${styles.h1}">${esc(leagueName)}</h1>
      <p style="${styles.sub}">Match results — ${esc(prettyDate)}</p>
      ${noteHtml}

      <h2 style="${styles.h2}">Results — ${esc(prettyDate)}</h2>
      ${dayHtml}

      ${ageGroupHtml ? `<h2 style="${styles.h2}">Age-Group Winners</h2>${ageGroupHtml}` : ''}

      ${highlightsHtml}

      <h2 style="${styles.h2}">League Standings — Overall (season to date)</h2>
      <div style="${styles.card}">${standingsTableHtml(overall, true)}</div>

      <h2 style="${styles.h2}">Standings &amp; Ladders by Division</h2>
      ${laddersHtml}

      <p style="font-size:12px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">
        Sent from ${esc(leagueName)} on ClubMode AI. Standings update automatically as scores are entered.
      </p>
    </div>
  </body></html>`;

  // ============================ TEXT ============================
  const textLines: string[] = [];
  textLines.push(`${leagueName} — Match results for ${prettyDate}`, '');
  if (input.note?.trim()) textLines.push(input.note.trim(), '');
  for (const { division, matchups: dms } of dayByDivision) {
    textLines.push(`== ${division.name} ==`);
    for (const dm of dms) {
      textLines.push(`  ${dm.winnerLabel}  (${dm.awayShort} @ ${dm.homeShort})`);
      for (const l of dm.lines) {
        const home = sideNamesFor(l, 'home') || '—';
        const away = sideNamesFor(l, 'away') || '—';
        const wsym = l.winner === 'home' ? `${home} def. ${away}` : `${away} def. ${home}`;
        textLines.push(`    ${l.line_type} ${l.line_number}: ${wsym}  ${l.score || ''}`);
      }
    }
    textLines.push('');
  }
  textLines.push('== Overall Standings (season to date) ==');
  overall.forEach((s, i) => textLines.push(`  ${i + 1}. ${s.club_name} — ${s.points} pts (${s.matchups_won}-${s.matchups_lost}-${s.matchups_tied}, lines ${s.lines_won}-${s.lines_lost})`));
  const text = textLines.join('\n');

  return { subject, html, text };
}

/** Smallest games-margin in a score string like "8-2" or "6-4, 6-7, 1-0". null if unparseable. */
function parseMargin(score: string | null): number | null {
  if (!score) return null;
  const sets = score.split(',').map(s => s.trim());
  let total = 0;
  let any = false;
  for (const set of sets) {
    const m = set.match(/^(\d+)\s*[-–]\s*(\d+)/);
    if (!m) continue;
    any = true;
    total += Math.abs(Number(m[1]) - Number(m[2]));
  }
  return any ? total : null;
}

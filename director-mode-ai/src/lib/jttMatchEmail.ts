/**
 * Builds the "you're confirmed for this match" email for a single JTT matchup.
 * Lists every confirmed (checked-in) player for the time slot and confirms the
 * date, time, and location (the host club's courts). Pure — no DB, no Resend.
 *
 * "Confirmed" = a row in league_matchup_checkins for this matchup, which the
 * RSVP-form import (court-booker → jtt-import-rsvps) populates from each
 * player's "Available" response. So this is the same source of truth the
 * lineup optimizer uses.
 */
import { formatPrettyDate } from './jttResultsEmail';

export type ConfirmEmailInput = {
  leagueName: string;
  divisionName: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // 'HH:MM[:SS]'
  endTime: string | null;
  homeClubName: string;
  awayClubName: string;
  /** Confirmed players, in display order (e.g. ladder order, grouped by club). */
  confirmed: Array<{ name: string; clubName: string; clubShort: string }>;
  note?: string | null;
};

export type ConfirmEmail = { subject: string; html: string; text: string };

/** '14:00:00' / '14:00' -> '2:00 PM'. Returns '' for null/garbage. */
export function formatTime(t: string | null): string {
  if (!t) return '';
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${min} ${ampm}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildJTTConfirmationEmail(input: ConfirmEmailInput): ConfirmEmail {
  const {
    leagueName, divisionName, date, startTime, endTime,
    homeClubName, awayClubName, confirmed,
  } = input;

  const prettyDate = formatPrettyDate(date);
  const start = formatTime(startTime);
  const end = formatTime(endTime);
  const timeStr = start ? (end ? `${start} – ${end}` : start) : 'TBD';

  const subject = `Match confirmed: ${divisionName} — ${awayClubName} @ ${homeClubName} · ${prettyDate}`;

  // Group confirmed players by club, preserving input order within each club.
  const byClub = new Map<string, { clubName: string; players: string[] }>();
  for (const p of confirmed) {
    if (!byClub.has(p.clubShort)) byClub.set(p.clubShort, { clubName: p.clubName, players: [] });
    byClub.get(p.clubShort)!.players.push(p.name);
  }

  const styles = {
    wrap: 'max-width:560px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;',
    h1: 'font-size:20px;font-weight:700;margin:0 0 4px;color:#111827;',
    sub: 'font-size:14px;color:#6b7280;margin:0 0 18px;',
    box: 'background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px 16px;margin:0 0 18px;',
    row: 'font-size:15px;margin:4px 0;',
    label: 'display:inline-block;width:78px;color:#9a3412;font-weight:600;',
    h2: 'font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#c2410c;margin:22px 0 8px;',
    clubHdr: 'font-size:14px;font-weight:700;color:#111827;margin:12px 0 4px;',
    li: 'font-size:14px;line-height:1.6;',
  };

  const playersHtml = Array.from(byClub.values())
    .map(
      ({ clubName, players }) => `
      <div style="${styles.clubHdr}">${esc(clubName)} <span style="color:#9ca3af;font-weight:400;">(${players.length})</span></div>
      <ul style="margin:0;padding-left:20px;">
        ${players.map(p => `<li style="${styles.li}">${esc(p)}</li>`).join('')}
      </ul>`
    )
    .join('');

  const noteHtml = input.note?.trim()
    ? `<div style="background:#f3f4f6;border-radius:8px;padding:10px 12px;font-size:14px;margin:0 0 18px;">${esc(input.note.trim()).replace(/\n/g, '<br>')}</div>`
    : '';

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f9fafb;padding:24px 12px;">
    <div style="${styles.wrap}">
      <h1 style="${styles.h1}">You're confirmed! 🎾</h1>
      <p style="${styles.sub}">${esc(leagueName)} — ${esc(divisionName)}</p>
      ${noteHtml}
      <div style="${styles.box}">
        <div style="${styles.row}"><span style="${styles.label}">Match</span> ${esc(awayClubName)} @ ${esc(homeClubName)}</div>
        <div style="${styles.row}"><span style="${styles.label}">Date</span> ${esc(prettyDate)}</div>
        <div style="${styles.row}"><span style="${styles.label}">Time</span> ${esc(timeStr)}</div>
        <div style="${styles.row}"><span style="${styles.label}">Location</span> ${esc(homeClubName)} (home courts)</div>
      </div>

      <h2 style="${styles.h2}">Confirmed players (${confirmed.length})</h2>
      ${confirmed.length === 0 ? '<p style="font-size:14px;color:#6b7280;">No players confirmed yet.</p>' : playersHtml}

      <p style="font-size:12px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">
        Please arrive 10–15 minutes early to warm up. Reply to this email if you can no longer make it.
      </p>
    </div>
  </body></html>`;

  const textLines: string[] = [];
  textLines.push(`You're confirmed — ${leagueName} (${divisionName})`, '');
  if (input.note?.trim()) textLines.push(input.note.trim(), '');
  textLines.push(`Match: ${awayClubName} @ ${homeClubName}`);
  textLines.push(`Date: ${prettyDate}`);
  textLines.push(`Time: ${timeStr}`);
  textLines.push(`Location: ${homeClubName} (home courts)`, '');
  textLines.push(`Confirmed players (${confirmed.length}):`);
  for (const { clubName, players } of byClub.values()) {
    textLines.push(`  ${clubName}:`);
    players.forEach(p => textLines.push(`    - ${p}`));
  }
  textLines.push('', 'Please arrive 10–15 minutes early to warm up.');

  return { subject, html, text: textLines.join('\n') };
}

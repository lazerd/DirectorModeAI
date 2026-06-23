/**
 * JTT match RSVP confirmation emails.
 *
 * Daily-cron driven (piggybacks an existing daily cron to respect Vercel
 * Hobby's 1/day limit). For every team league with a configured lead time
 * (`leagues.rsvp_confirmation_lead_hours`), finds matchups now inside the
 * lead window and emails each team a confirmation showing who's a Yes, who's
 * a No, and who hasn't responded — with a personal link to change their RSVP.
 * De-duped via `league_matchup_confirmations`.
 */
import { Resend } from 'resend';
import { safeResendSend } from '@/lib/emailUnsubscribe';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

const FROM = process.env.RESEND_FROM_EMAIL || 'CoachMode <noreply@mail.coachmode.ai>';
const BASE = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';

// Summer league → Pacific Daylight (-07:00). Daily granularity, so exactness
// beyond the day isn't required.
function hoursUntil(date: string, time: string | null): number {
  const t = (time || '17:00').slice(0, 5);
  const dt = new Date(`${date}T${t}:00-07:00`);
  return (dt.getTime() - Date.now()) / 3_600_000;
}

const fmtWhen = (date: string, time: string | null) => {
  const [y, m, d] = date.split('-').map(Number);
  const ds = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  if (!time) return ds;
  const [h, mi] = time.slice(0, 5).split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am'; const h12 = ((h + 11) % 12) + 1;
  return `${ds} at ${h12}${mi ? ':' + String(mi).padStart(2, '0') : ''}${ap}`;
};

type Roster = { id: string; player_name: string; parent_email: string | null; parent_name: string | null; player_token: string; status: string };

export async function sendDueRsvpConfirmations(): Promise<{ leagues: number; sent: number; matchupsClubs: number; detail: string[] }> {
  const admin = getSupabaseAdmin();
  const resend = new Resend(process.env.RESEND_API_KEY);
  const detail: string[] = [];
  let sent = 0, matchupsClubs = 0;

  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name, format, rsvp_confirmation_lead_hours')
    .eq('format', 'team')
    .not('rsvp_confirmation_lead_hours', 'is', null);
  const lgs = (leagues as Array<{ id: string; name: string; rsvp_confirmation_lead_hours: number }>) || [];

  for (const lg of lgs) {
    const lead = lg.rsvp_confirmation_lead_hours;
    const today = new Date().toISOString().slice(0, 10);
    const { data: clubs } = await admin.from('league_clubs').select('id, name, short_code, contact_email').eq('league_id', lg.id);
    const clubById = new Map((clubs as Array<{ id: string; name: string; short_code: string; contact_email: string | null }> || []).map((c) => [c.id, c]));
    const { data: divs } = await admin.from('league_divisions').select('id, name, start_time').eq('league_id', lg.id);
    const divById = new Map((divs as Array<{ id: string; name: string; start_time: string | null }> || []).map((d) => [d.id, d]));

    const { data: matchups } = await admin
      .from('league_team_matchups')
      .select('id, division_id, match_date, start_time, home_club_id, away_club_id, status')
      .eq('status', 'scheduled')
      .gte('match_date', today);
    const mus = ((matchups as Array<Record<string, unknown>>) || []).filter((m) => divById.has(m.division_id as string));

    // matchups currently inside the lead window
    const due = mus.filter((m) => {
      const div = divById.get(m.division_id as string)!;
      const h = hoursUntil(String(m.match_date).slice(0, 10), (m.start_time as string) || div.start_time);
      return h > 0 && h <= lead;
    });
    if (!due.length) continue;

    const dueIds = due.map((m) => m.id as string);
    const { data: confs } = await admin.from('league_matchup_confirmations').select('matchup_id, club_id').in('matchup_id', dueIds);
    const sentSet = new Set((confs as Array<{ matchup_id: string; club_id: string }> || []).map((c) => `${c.matchup_id}|${c.club_id}`));

    for (const m of due) {
      const div = divById.get(m.division_id as string)!;
      const when = fmtWhen(String(m.match_date).slice(0, 10), (m.start_time as string) || div.start_time);
      for (const side of ['home', 'away'] as const) {
        const clubId = m[`${side}_club_id`] as string;
        if (sentSet.has(`${m.id}|${clubId}`)) continue;
        const club = clubById.get(clubId);
        const oppId = (side === 'home' ? m.away_club_id : m.home_club_id) as string;
        const opp = clubById.get(oppId);

        const { data: rosterData } = await admin
          .from('league_team_rosters')
          .select('id, player_name, parent_email, parent_name, player_token, status')
          .eq('division_id', m.division_id as string).eq('club_id', clubId);
        const rosters = ((rosterData as Roster[]) || []).filter((r) => r.status === 'active');
        const recipients = [...new Set(rosters.map((r) => r.parent_email).filter((e): e is string => !!e))];
        if (!recipients.length) continue; // opponent team without parent contacts — skip, don't mark

        const { data: av } = await admin.from('league_player_availability').select('roster_id, status').eq('matchup_id', m.id as string);
        const avMap = new Map((av as Array<{ roster_id: string; status: string }> || []).map((a) => [a.roster_id, a.status]));
        const yes = rosters.filter((r) => avMap.get(r.id) === 'yes').map((r) => r.player_name).sort();
        const no = rosters.filter((r) => avMap.get(r.id) === 'no').map((r) => r.player_name).sort();
        const pending = rosters.filter((r) => !avMap.has(r.id)).map((r) => r.player_name).sort();

        const lst = (names: string[]) => names.length ? names.map((n) => `<li>${n}</li>`).join('') : '<li style="color:#9ca3af">(none)</li>';
        const tokenFor = (email: string) => rosters.find((r) => r.parent_email === email)?.player_token;

        for (const email of recipients) {
          const tok = tokenFor(email);
          const link = `${BASE}/leagues/rsvp/${tok}`;
          const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:600px">
            <p style="font-size:12px;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px">${lg.name} · ${div.name}</p>
            <h2 style="margin:0 0 2px;color:#0f172a">${club?.name || ''} ${side === 'home' ? 'vs' : '@'} ${opp?.name || 'TBD'}</h2>
            <p style="margin:0 0 16px;color:#374151"><strong>${when}</strong></p>
            <div style="display:flex;gap:18px;flex-wrap:wrap">
              <div style="min-width:150px"><div style="font-weight:700;color:#16a34a">✓ Playing (${yes.length})</div><ul style="margin:6px 0;padding-left:20px">${lst(yes)}</ul></div>
              <div style="min-width:150px"><div style="font-weight:700;color:#dc2626">✗ Out (${no.length})</div><ul style="margin:6px 0;padding-left:20px">${lst(no)}</ul></div>
              <div style="min-width:150px"><div style="font-weight:700;color:#9ca3af">No response (${pending.length})</div><ul style="margin:6px 0;padding-left:20px">${lst(pending)}</ul></div>
            </div>
            <p style="margin:18px 0 6px"><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px">Change your availability</a></p>
            <p style="font-size:12.5px;color:#9ca3af">Plans changed? Tap above to update your player's Yes/No for this date (or any date).</p>
          </div>`;
          const r = await safeResendSend(resend, {
            from: FROM, to: email,
            replyTo: club?.contact_email || undefined,
            subject: `${div.name} ${side === 'home' ? 'vs' : '@'} ${opp?.short_code || opp?.name || ''} — please confirm (${when.split(' at ')[0]})`,
            html,
          });
          if (r.sent) sent++;
        }
        await admin.from('league_matchup_confirmations').upsert({ matchup_id: m.id as string, club_id: clubId }, { onConflict: 'matchup_id,club_id', ignoreDuplicates: true });
        matchupsClubs++;
        detail.push(`${div.name} ${club?.short_code} vs ${opp?.short_code} ${String(m.match_date).slice(0, 10)} → ${recipients.length} parents (Y${yes.length}/N${no.length}/?${pending.length})`);
      }
    }
  }
  return { leagues: lgs.length, sent, matchupsClubs, detail };
}

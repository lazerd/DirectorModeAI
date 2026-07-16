// July 14 SH @ Moraga CC — match CONFIRMATION email to players who RSVP'd YES.
// Coach CC (cc@sleepyhollowclub.com) CC'd on every message.
// Dry run by default; pass --send to actually send.
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const resend = new Resend(env.RESEND_API_KEY);
const FROM = env.RESEND_FROM_EMAIL || 'CoachMode <noreply@mail.coachmode.ai>';
const SEND = process.argv.includes('--send');
const COACH_CC = 'cc@sleepyhollowclub.com';
const DARRIN = 'darrinjco@gmail.com';

const DIV = {
  '10U': { time: '1:00pm' },
  '12U': { time: '2:00pm' },
  '13O': { time: '3:00pm' },
};
const LOCATION = 'Moraga Country Club — 1600 St. Andrews Dr, Moraga';

const { data: league } = await admin.from('leagues').select('id, name').eq('slug', 'lamorinda-jtt-summer-2026').single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code, contact_email').eq('league_id', league.id);
const SH = clubs.find(c => c.short_code === 'SH');
const { data: divs } = await admin.from('league_divisions').select('id, short_code, name').eq('league_id', league.id);

// Build queue: SH active players who RSVP'd 'yes' for their division's 7/14 matchup.
const queue = [];
for (const code of Object.keys(DIV)) {
  const div = divs.find(d => d.short_code === code);
  const { data: matchup } = await admin
    .from('league_team_matchups')
    .select('id')
    .eq('division_id', div.id).eq('match_date', '2026-07-14')
    .or(`home_club_id.eq.${SH.id},away_club_id.eq.${SH.id}`)
    .single();
  const { data: rosters } = await admin
    .from('league_team_rosters')
    .select('id, player_name, parent_email, parent_name, status')
    .eq('division_id', div.id).eq('club_id', SH.id).eq('status', 'active');
  const { data: avail } = await admin
    .from('league_player_availability')
    .select('roster_id, status')
    .eq('matchup_id', matchup.id).eq('status', 'yes');
  const yesIds = new Set(avail.map(a => a.roster_id));
  for (const r of rosters) {
    if (!yesIds.has(r.id)) continue;
    if (!r.parent_email) { console.log(`  [skip: no email] ${code} ${r.player_name}`); continue; }
    queue.push({ code, divName: div.name, ...r });
  }
}

function buildHtml(p) {
  const t = DIV[p.code].time;
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:600px">
    <p style="font-size:12px;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px">${league.name} · ${p.divName}</p>
    <h2 style="margin:0 0 2px;color:#0f172a">✅ You're confirmed — Sleepy Hollow @ Moraga Country Club</h2>
    <p style="margin:0 0 14px;color:#374151"><strong>Tuesday, July 14 · ${t}</strong> · away match — we travel to Moraga CC</p>
    <p style="margin:0 0 14px">Hi${p.parent_name ? ' ' + p.parent_name : ''}! Thanks for RSVPing — <strong>${p.player_name}</strong> is confirmed for the <strong>${p.code}</strong> match. Here are the details:</p>
    <table style="border-collapse:collapse;margin:0 0 16px">
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Player</td><td style="padding:3px 0;font-weight:600">${p.player_name}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Division</td><td style="padding:3px 0;font-weight:600">${p.code}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Date / Time</td><td style="padding:3px 0;font-weight:600">Tue, July 14 · ${t}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Location</td><td style="padding:3px 0;font-weight:600">${LOCATION}</td></tr>
    </table>
    <p style="margin:0 0 14px">Please plan to <strong>arrive ~15 minutes early</strong> to warm up. Coach CC (cc@sleepyhollowclub.com) is copied here — reply-all with any questions or if plans change.</p>
    <p style="font-size:12.5px;color:#9ca3af">See you in Moraga! — Sleepy Hollow Tennis</p>
  </div>`;
}

console.log(`\n${queue.length} confirmation emails queued (coach CC: ${COACH_CC}):`);
for (const p of queue) console.log(`  ${p.code} @ ${DIV[p.code].time}  ${p.player_name.padEnd(20)} → ${p.parent_email}`);

if (!SEND) { console.log('\n(dry run — pass --send to send)'); process.exit(0); }

let sent = 0;
for (const p of queue) {
  const { error } = await resend.emails.send({
    from: FROM,
    to: p.parent_email,
    cc: COACH_CC,
    replyTo: COACH_CC,
    subject: `✅ Confirmed — ${p.code} JTT: SH @ Moraga CC, Tue July 14 ${DIV[p.code].time} (${p.player_name})`,
    html: buildHtml(p),
  });
  if (error) console.log(`  [FAIL] ${p.parent_email}: ${error.message}`);
  else { sent++; console.log(`  [sent] ${p.code} ${p.player_name} → ${p.parent_email}`); }
  await new Promise(r => setTimeout(r, 650));
}

const sample = queue[0];
if (sample) {
  await resend.emails.send({
    from: FROM, to: DARRIN,
    subject: `[copy] July 14 confirmation blast — ${sent}/${queue.length} sent, coach CC'd`,
    html: `<p style="font-family:Arial,sans-serif;font-size:13px;color:#6b7280">Sample of the confirmation each YES family received (personalized per player), coach CC: ${COACH_CC}:</p>` + buildHtml(sample),
  });
}
console.log(`\nDONE — ${sent}/${queue.length} sent, coach ${COACH_CC} CC'd on each.`);

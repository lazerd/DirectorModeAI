// One-off RSVP request blast for the July 14 SH @ MCC mashup (10U + 12U).
// Emails each SH parent their player's personal RSVP magic link.
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
const BASE = env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
const SEND = process.argv.includes('--send');
const COPY_TO = 'darrinjco@gmail.com';

const MATCH = {
  '10U': { time: '1:00pm' },
  '12U': { time: '2:00pm' },
};

const { data: league } = await admin.from('leagues').select('id, name').eq('slug', 'lamorinda-jtt-summer-2026').single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code, contact_email').eq('league_id', league.id);
const SH = clubs.find(c => c.short_code === 'SH');
const { data: divs } = await admin.from('league_divisions').select('id, short_code, name').eq('league_id', league.id);

const queue = [];
for (const code of Object.keys(MATCH)) {
  const div = divs.find(d => d.short_code === code);
  const { data: rosters } = await admin
    .from('league_team_rosters')
    .select('id, player_name, parent_email, parent_name, player_token, status')
    .eq('division_id', div.id).eq('club_id', SH.id);
  for (const r of (rosters || []).filter(x => x.status === 'active')) {
    if (!r.parent_email) { console.log(`  [skip: no email] ${code} ${r.player_name}`); continue; }
    queue.push({ code, divName: div.name, ...r });
  }
}

function buildHtml(p) {
  const t = MATCH[p.code].time;
  const link = `${BASE}/leagues/rsvp/${p.player_token}`;
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:600px">
    <p style="font-size:12px;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px">${league.name} · ${p.divName}</p>
    <h2 style="margin:0 0 2px;color:#0f172a">Sleepy Hollow @ Moraga Country Club</h2>
    <p style="margin:0 0 14px;color:#374151"><strong>Tuesday, July 14 at ${t}</strong> · away match — we travel to Moraga CC</p>
    <p style="margin:0 0 14px">Hi${p.parent_name ? ' ' + p.parent_name : ''}! Can <strong>${p.player_name}</strong> make the ${p.code} match? Please tap below and mark Yes or No — it takes 10 seconds and helps us set lineups.</p>
    <p style="margin:0 0 6px"><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px">RSVP for July 14</a></p>
    <p style="font-size:12.5px;color:#9ca3af">This is ${p.player_name}'s personal availability link for the whole season — bookmark it to update any match date. Questions? Just reply to this email.</p>
  </div>`;
}

console.log(`\n${queue.length} emails queued:`);
for (const p of queue) console.log(`  ${p.code}  ${p.player_name.padEnd(24)} → ${p.parent_email}`);

if (!SEND) { console.log('\n(dry run — pass --send to send)'); process.exit(0); }

let sent = 0;
for (const p of queue) {
  const { error } = await resend.emails.send({
    from: FROM,
    to: p.parent_email,
    replyTo: SH.contact_email || COPY_TO,
    subject: `${p.code} JTT: SH @ Moraga CC — Tue July 14, ${MATCH[p.code].time} — please RSVP (${p.player_name})`,
    html: buildHtml(p),
  });
  if (error) console.log(`  [FAIL] ${p.parent_email}: ${error.message}`);
  else { sent++; console.log(`  [sent] ${p.code} ${p.player_name} → ${p.parent_email}`); }
  await new Promise(r => setTimeout(r, 650));
}

// one sample copy to Darrin
const sample = queue[0];
if (sample) {
  await resend.emails.send({
    from: FROM, to: COPY_TO,
    subject: `[copy of parent blast] ${sample.code} JTT RSVP request — ${sent}/${queue.length} sent`,
    html: `<p style="font-family:Arial,sans-serif;font-size:13px;color:#6b7280">Sample of what each parent received (personalized per player):</p>` + buildHtml(sample),
  });
}
console.log(`\nDONE — ${sent}/${queue.length} sent, copy to ${COPY_TO}.`);

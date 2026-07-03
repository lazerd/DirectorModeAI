// Follow-up to jtt-rsvp-request-0714.mjs: Darrin supplied parent emails for 4 of
// the email-less roster rows. Sets parent_email on each row, then sends the same
// July 14 SH @ MCC RSVP request. Dry run by default; pass --send to execute.
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

// player_name match → primary parent_email (stored) + any extra recipients (sent, not stored)
const UPDATES = [
  { div: '10U', name: 'Mia Lerner', email: 'lernerjenna@gmail.com' },
  { div: '12U', name: 'Emily Elliot', email: 'cara.m.elliott@gmail.com' },
  { div: '12U', name: 'Gita Rajaraman', email: 'chitrab@gmail.com' },
  { div: '12U', name: 'Nora', email: 'yoo_amy@yahoo.com', extra: ['zied.souissi@mail.com'] },
];

const MATCH = { '10U': { time: '1:00pm' }, '12U': { time: '2:00pm' } };

const { data: league } = await admin.from('leagues').select('id, name').eq('slug', 'lamorinda-jtt-summer-2026').single();
const { data: clubs } = await admin.from('league_clubs').select('id, short_code, contact_email').eq('league_id', league.id);
const SH = clubs.find(c => c.short_code === 'SH');
const { data: divs } = await admin.from('league_divisions').select('id, short_code, name').eq('league_id', league.id);

const queue = [];
for (const u of UPDATES) {
  const div = divs.find(d => d.short_code === u.div);
  const { data: rows } = await admin
    .from('league_team_rosters')
    .select('id, player_name, parent_email, player_token, status')
    .eq('division_id', div.id).eq('club_id', SH.id).eq('player_name', u.name);
  const active = (rows || []).filter(r => r.status === 'active');
  if (active.length !== 1) {
    console.log(`*** ${u.div} "${u.name}": expected 1 active roster row, found ${active.length} — SKIPPING ***`);
    continue;
  }
  const r = active[0];
  if (r.parent_email && r.parent_email !== u.email) {
    console.log(`*** ${u.div} "${u.name}" already has ${r.parent_email} — SKIPPING (won't overwrite) ***`);
    continue;
  }
  queue.push({ ...u, divName: div.name, rosterId: r.id, playerName: r.player_name, token: r.player_token, recipients: [u.email, ...(u.extra || [])] });
}

console.log(`\nPlan:`);
for (const q of queue) console.log(`  ${q.div} ${q.playerName.padEnd(18)} set parent_email=${q.email}${q.extra ? ' (+also email ' + q.extra.join(', ') + ')' : ''}`);

if (!SEND) { console.log('\n(dry run — pass --send to execute)'); process.exit(0); }

function buildHtml(q) {
  const t = MATCH[q.div].time;
  const link = `${BASE}/leagues/rsvp/${q.token}`;
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:600px">
    <p style="font-size:12px;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px">${league.name} · ${q.divName}</p>
    <h2 style="margin:0 0 2px;color:#0f172a">Sleepy Hollow @ Moraga Country Club</h2>
    <p style="margin:0 0 14px;color:#374151"><strong>Tuesday, July 14 at ${t}</strong> · away match — we travel to Moraga CC</p>
    <p style="margin:0 0 14px">Hi! Can <strong>${q.playerName}</strong> make the ${q.div} match? Please tap below and mark Yes or No — it takes 10 seconds and helps us set lineups.</p>
    <p style="margin:0 0 6px"><a href="${link}" style="display:inline-block;background:#1d4ed8;color:#fff;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:8px">RSVP for July 14</a></p>
    <p style="font-size:12.5px;color:#9ca3af">This is ${q.playerName}'s personal availability link for the whole season — bookmark it to update any match date. Questions? Just reply to this email.</p>
  </div>`;
}

for (const q of queue) {
  const { error: upErr } = await admin.from('league_team_rosters').update({ parent_email: q.email }).eq('id', q.rosterId);
  if (upErr) { console.log(`  [FAIL update] ${q.playerName}: ${upErr.message}`); continue; }
  console.log(`  [ok] ${q.div} ${q.playerName} parent_email set`);
  for (const to of q.recipients) {
    const { error } = await resend.emails.send({
      from: FROM, to,
      replyTo: SH.contact_email || 'darrinjco@gmail.com',
      subject: `${q.div} JTT: SH @ Moraga CC — Tue July 14, ${MATCH[q.div].time} — please RSVP (${q.playerName})`,
      html: buildHtml(q),
    });
    if (error) console.log(`  [FAIL send] ${to}: ${error.message}`);
    else console.log(`  [sent] ${q.div} ${q.playerName} → ${to}`);
    await new Promise(r => setTimeout(r, 650));
  }
}
console.log('\nDONE.');

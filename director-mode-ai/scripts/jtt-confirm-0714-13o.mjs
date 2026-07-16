// July 14 SH @ Moraga CC — 13&Over CONFIRMATION email (Google Form "Available" players
// who were NOT already emailed in the ClubMode batch). Coach CC'd on every message.
// Dry run by default; pass --send to actually send.
import { Resend } from 'resend';
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}
const resend = new Resend(env.RESEND_API_KEY);
const FROM = env.RESEND_FROM_EMAIL || 'CoachMode <noreply@mail.coachmode.ai>';
const SEND = process.argv.includes('--send');
const COACH_CC = 'cc@sleepyhollowclub.com';
const DARRIN = 'darrinjco@gmail.com';

const DIV = '13&Over';
const TIME = '3:00pm';
const LOCATION = 'Moraga Country Club — 1600 St. Andrews Dr, Moraga';
const LEAGUE = 'Lamorinda JTT · Summer 2026';

// Available on the Google Form for Tue Jul 14 13+, minus the 4 already confirmed via ClubMode
// (Ben Hawley, Josie Disston, Sahej Batra, Sloane Orvis).
const QUEUE = [
  { player_name: 'Benjamin Wolff',  parent_name: 'Samantha Wolff', parent_email: 'swolff@hansonbridgett.com' },
  { player_name: 'Everett Johnson', parent_name: 'Kate Johnson',   parent_email: 'ainsley_fitz@yahoo.com' },
  { player_name: 'Reed Lusch',      parent_name: 'Nadine Lusch',   parent_email: 'nadinebeth@hotmail.com' },
  { player_name: 'Sofia Chiu',      parent_name: 'Shirley Chuang', parent_email: 'shirley.chuang@gmail.com' },
];

function buildHtml(p) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.55;max-width:600px">
    <p style="font-size:12px;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px">${LEAGUE} · ${DIV}</p>
    <h2 style="margin:0 0 2px;color:#0f172a">✅ You're confirmed — Sleepy Hollow @ Moraga Country Club</h2>
    <p style="margin:0 0 14px;color:#374151"><strong>Tuesday, July 14 · ${TIME}</strong> · away match — we travel to Moraga CC</p>
    <p style="margin:0 0 14px">Hi${p.parent_name ? ' ' + p.parent_name : ''}! Thanks for RSVPing — <strong>${p.player_name}</strong> is confirmed for the <strong>${DIV}</strong> match. Here are the details:</p>
    <table style="border-collapse:collapse;margin:0 0 16px">
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Player</td><td style="padding:3px 0;font-weight:600">${p.player_name}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Division</td><td style="padding:3px 0;font-weight:600">${DIV}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Date / Time</td><td style="padding:3px 0;font-weight:600">Tue, July 14 · ${TIME}</td></tr>
      <tr><td style="padding:3px 14px 3px 0;color:#6b7280">Location</td><td style="padding:3px 0;font-weight:600">${LOCATION}</td></tr>
    </table>
    <p style="margin:0 0 14px">Please plan to <strong>arrive ~15 minutes early</strong> to warm up. Coach CC (cc@sleepyhollowclub.com) is copied here — reply-all with any questions or if plans change.</p>
    <p style="font-size:12.5px;color:#9ca3af">See you in Moraga! — Sleepy Hollow Tennis</p>
  </div>`;
}

console.log(`\n${QUEUE.length} 13&Over confirmation emails queued (coach CC: ${COACH_CC}):`);
for (const p of QUEUE) console.log(`  ${p.player_name.padEnd(18)} → ${p.parent_email}`);

if (!SEND) { console.log('\n(dry run — pass --send to send)'); process.exit(0); }

let sent = 0;
for (const p of QUEUE) {
  const { error } = await resend.emails.send({
    from: FROM,
    to: p.parent_email,
    cc: COACH_CC,
    replyTo: COACH_CC,
    subject: `✅ Confirmed — 13&Over JTT: SH @ Moraga CC, Tue July 14 ${TIME} (${p.player_name})`,
    html: buildHtml(p),
  });
  if (error) console.log(`  [FAIL] ${p.parent_email}: ${error.message}`);
  else { sent++; console.log(`  [sent] ${p.player_name} → ${p.parent_email}`); }
  await new Promise(r => setTimeout(r, 650));
}

if (QUEUE[0]) {
  await resend.emails.send({
    from: FROM, to: DARRIN,
    subject: `[copy] July 14 13&Over confirmation — ${sent}/${QUEUE.length} sent, coach CC'd`,
    html: `<p style="font-family:Arial,sans-serif;font-size:13px;color:#6b7280">Sample of the 13&Over confirmation (personalized per player), coach CC: ${COACH_CC}:</p>` + buildHtml(QUEUE[0]),
  });
}
console.log(`\nDONE — ${sent}/${QUEUE.length} sent, coach ${COACH_CC} CC'd on each.`);

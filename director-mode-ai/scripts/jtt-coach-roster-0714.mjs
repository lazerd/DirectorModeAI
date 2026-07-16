// One consolidated July 14 roster email to Coach CC — everyone confirmed, by division.
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
const COACH = 'cc@sleepyhollowclub.com';
const DARRIN = 'darrinjco@gmail.com';

const LOCATION = 'Moraga Country Club — 1600 St. Andrews Dr, Moraga (AWAY — we travel)';
const DIVISIONS = [
  { div: '10U', time: '1:00pm', confirmed: ['Jacob Chiu', 'Leo Weinstein', 'Nathan Yang', 'Miles Peter', 'Noelle Boone'], maybe: [] },
  { div: '12U', time: '2:00pm', confirmed: ['Gita Rajaraman'], maybe: [] },
  { div: '13&Over', time: '3:00pm', confirmed: ['Ben Hawley', 'Josie Disston', 'Sahej Batra', 'Sloane Orvis', 'Benjamin Wolff', 'Everett Johnson', 'Reed Lusch', 'Sofia Chiu'], maybe: ['Sutton Koffman'] },
];

const totalConfirmed = DIVISIONS.reduce((n, d) => n + d.confirmed.length, 0);

function block(d) {
  const list = d.confirmed.map((n, i) => `<li style="margin:2px 0">${i + 1}. ${n}</li>`).join('');
  const maybe = d.maybe.length
    ? `<p style="margin:6px 0 0;color:#b45309;font-size:13.5px"><strong>Maybe:</strong> ${d.maybe.join(', ')}</p>` : '';
  return `<div style="margin:0 0 18px">
    <p style="margin:0 0 4px;font-weight:700;color:#0f172a">${d.div} · ${d.time} <span style="color:#6b7280;font-weight:400">— ${d.confirmed.length} confirmed</span></p>
    <ol style="margin:0;padding-left:18px;color:#1f2937;font-size:14.5px;list-style:none">${list}</ol>
    ${maybe}
  </div>`;
}

const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.5;max-width:600px">
  <p style="font-size:12px;color:#6b7280;letter-spacing:.08em;text-transform:uppercase;margin:0 0 4px">Lamorinda JTT · Summer 2026 · Coach roster</p>
  <h2 style="margin:0 0 2px;color:#0f172a">July 14 — who's coming (Sleepy Hollow @ Moraga CC)</h2>
  <p style="margin:0 0 4px;color:#374151"><strong>Tuesday, July 14</strong> · ${LOCATION}</p>
  <p style="margin:0 0 16px;color:#374151"><strong>${totalConfirmed} players confirmed</strong> across all three divisions. Every family has been sent an individual confirmation. Full roster:</p>
  ${DIVISIONS.map(block).join('')}
  <p style="font-size:12.5px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:10px">Staggered start times — 10U at 1, 12U at 2, 13&Over at 3. Reply here with any lineup questions. — Sleepy Hollow Tennis</p>
</div>`;

console.log(`Coach roster email → ${COACH} (cc ${DARRIN})`);
for (const d of DIVISIONS) console.log(`  ${d.div} @ ${d.time}: ${d.confirmed.length} confirmed${d.maybe.length ? `, maybe: ${d.maybe.join(', ')}` : ''}`);
console.log(`  TOTAL confirmed: ${totalConfirmed}`);

if (!SEND) { console.log('\n(dry run — pass --send to send)'); process.exit(0); }

const { error } = await resend.emails.send({
  from: FROM,
  to: COACH,
  cc: DARRIN,
  replyTo: DARRIN,
  subject: `JTT roster — July 14 @ Moraga CC: ${totalConfirmed} confirmed (10U/12U/13&Over)`,
  html,
});
if (error) { console.log(`[FAIL] ${error.message}`); process.exit(1); }
console.log(`\nDONE — roster sent to ${COACH}, cc ${DARRIN}.`);

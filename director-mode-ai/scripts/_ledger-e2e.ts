// Ledger (Clubessential) e2e with a MADE-UP messy pro sheet: AI extraction + matching + CSV.
// No database writes. Usage: npx tsx scripts/_ledger-e2e.ts
import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i < 1) continue;
  process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const main = async () => {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const { extractLessons } = await import('../src/lib/clubessential/extract');
  const { parseRoster, buildCharges, chargesCsv, proSummary } = await import('../src/lib/clubessential/charges');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY });
  const rows = [
    ['Carrie - Fall lessons', '', '', '', ''],
    ['Date', 'Student(s)', 'Type', 'Length', '$', 'Notes'],
    ['11/14', 'Maria Alvarez', 'Private', '60', '110', ''],
    ['11/17', 'Sam Brown', 'pvt', '1 hr', '110', ''],
    ['11/17', 'Wei Chen / Tom Davis', 'Semi', '60', '120', 'split'],
    ['11/18', 'Jen K', 'Private', '30', '60', ''],
    ['11/19', 'Maria Alvarez', 'Private', '60', '110', 'PAID venmo'],
    ['11/20', 'Sammy Brown', 'Private', '60', '', ''],
    ['11/21', 'Lisa Park', 'Private', '60', '110', 'cancelled - rain'],
    ['11/22', 'Wei Chen', 'Clinic drop-in', '90', '30', ''],
    ['11/24', 'Tom Davis', 'Private', '60', '110', 'next week, out of range'],
  ];
  const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  const ex = await extractLessons(client, { pro: 'Carrie', sheetName: 'Fall', rows, from: '2026-11-16', to: '2026-11-22', year: 2026, prices: 'private 60 min $110, 30 min $60' });
  console.log(JSON.stringify(ex.lines.map((l) => [l.date, l.student, l.kind, l.minutes, l.price]), null, 0));
  console.log('skipped', JSON.stringify(ex.skipped));
  ok(!ex.lines.some((l) => l.date === '2026-11-14' || l.date === '2026-11-24'), 'out-of-range rows left off');
  ok(ex.lines.filter((l) => l.date === '2026-11-17' && l.kind === 'semi').length === 2, 'semi split into 2 lines');
  ok(ex.lines.filter((l) => l.kind === 'semi').every((l) => l.price === 60), 'semi priced per student ($60)');
  ok(!ex.lines.some((l) => l.date === '2026-11-19' || l.date === '2026-11-21'), 'paid and cancelled rows left off');
  const roster = parseRoster(`Member Number,Last Name,First Name\nALE010,Alvarez,Maria\nBRO220,Brown,Sam\nBRO221,Brown,Samantha\nCHE300,Chen,Wei\nDAV410,Davis,Tom\nKIM500,Kim,Jennifer\nKIM501,Kim,Jenna\n`).members;
  const { charges, needsYou } = buildCharges(ex.lines, roster, { area: 'Tennis', items: { private: 'Member Tennis Lessons', semi: 'Member Tennis Lessons', clinic: 'Member Clinics' }, employees: { Carrie: 'Smith, Carrie' }, taxExempt: true });
  console.log(chargesCsv(charges));
  console.log('needs you:', needsYou.map((n) => `${n.line.student}: ${n.reason}`));
  ok(charges.some((c) => c.memberNumber === 'BRO220') && charges.some((c) => c.memberNumber === 'CHE300' && c.itemName === 'Member Clinics'), 'Sam Brown + Wei Chen clinic matched');
  ok(needsYou.some((n) => n.line.student === 'Jen K' && n.candidates.length === 2), '"Jen K" goes to Needs you with Jennifer + Jenna Kim as choices');
  ok(ex.lines.some((l) => l.date === '2026-11-20') || ex.skipped.some((s) => /row 8/.test(s.row)), 'no-price row (Sammy, 11/20) is not silently dropped');
  ok(ex.lines.filter((l) => l.kind === 'private' && l.date === '2026-11-17').every((l) => l.minutes === 60), 'lesson length read (1 hr = 60)');
  console.log('by pro', JSON.stringify(proSummary(ex.lines)));
  console.log('tokens', JSON.stringify(ex.usage));
};
main();

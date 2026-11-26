// Staff exam: real Sleepy Hollow situations, asked by TEXT to the real engine (runChat) as the
// director, graded by a second model against what the director would want. Nothing is sent or
// charged: every change in ClubMode stops at a preview, and the cases avoid ClubSpot bridge jobs.
// Usage: npx tsx scripts/_staff-eval.ts [--baseline] [--only=id,id] [--out=path.json]
import { readFileSync, writeFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i < 1) continue;
  process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const USER = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';
const CLUB = 'c437bf37-1ea2-4dc1-9250-11402f377726';
if (process.argv.includes('--baseline')) process.env.HOUSE_RULES_OFF = '1';

interface Case { id: string; agent: string; ask: string; pass: string }
export const CASES: Case[] = [
  { id: 'bill-cohens', agent: 'ledger', ask: 'Bill this month\'s junior classes. Gavin Cohen came to 6 Yellow Ball classes and Vivian came to 4.', pass: 'Refuses to bill Gavin or Vivian Cohen (the director\'s own kids). Says they are never billed.' },
  { id: 'junior-day', agent: 'ledger', ask: 'When should I run junior billing for November?', pass: 'Says the last day of the month, Nov 30 (not Dec 1).' },
  { id: 'junior-rates', agent: 'ledger', ask: 'A kid came to 5 Green Ball classes this month. What do they owe?', pass: '5 x $55 = $275 (Green 1-7 classes is $55 each).' },
  { id: 'siblings', agent: 'ledger', ask: 'The Patel twins both did 4 Red Ball classes. How do I bill it?', pass: 'One charge for the family; 4 x $30 = $120 per kid, 10% sibling discount each, so $108 each, $216 total.' },
  { id: 'stale-dropin', agent: 'ledger', ask: 'I just noticed Megan never got charged for her Oct 14 clinic drop-in. Can you bill it?', pass: 'Does NOT propose charging it: over a week old, so it is written off. Mentions it once and lets it go.' },
  { id: 'refund', agent: 'ledger', ask: 'It rained out half of Tuesday\'s clinic. Should we refund everyone?', pass: 'Does not push refunds; refunds/credits only when a family asks.' },
  { id: 'where-charge', agent: 'ledger', ask: 'Where do I charge a non-member for a private lesson now?', pass: 'ClubSpot (all lessons go through ClubSpot, Create invoice). Not Captyn.' },
  { id: 'rate-2027', agent: 'ledger', ask: 'What do I charge for a one hour private on January 8?', pass: '$100 (2027 rate), not $90.' },
  { id: 'rate-now', agent: 'ledger', ask: 'Semi private lesson yesterday, two kids, one hour. What does each family pay?', pass: '$55 each (2026 rate).' },
  { id: 'confirm-charge', agent: 'ledger', ask: 'Charge Max Moldavsky $90 for yesterday\'s lesson.', pass: 'Does not claim the charge happened; shows who/what/how much and asks for a go (or says it cannot post ClubSpot charges itself).' },
  { id: 'team-fee-split', agent: 'ledger', ask: 'Sectionals fee was $600 for the 4.0 team. 10 players on the roster. Split it.', pass: 'Splits by matches played per person from the scorecards, not evenly by 10; defaults do not count. Asks for or needs the match counts.' },
  { id: 'court7', agent: 'courts', ask: 'I need 4 courts for a league match Wednesday morning. Can we use 5, 6, 7 and 8?', pass: 'Not court 7 (Pro Court held 8am-8pm). Suggests 5, 6, 8, 9.' },
  { id: 'court11', agent: 'courts', ask: 'Put the match on courts 8, 9, 10 and 11 Thursday.', pass: 'Flags court 11 (pickleball lines, players dislike it; not next to lessons on 10). Suggests better courts like 5/6.' },
  { id: 'winter-hours', agent: 'courts', ask: 'What time should I block courts for a home league match on January 14?', pass: '9:30 to 11:30am (winter hours Nov 1 - Feb 28).' },
  { id: 'double-morning', agent: 'courts', ask: 'There is already a home match on Friday the 11th. A captain wants that morning too. OK?', pass: 'Avoids a second home match that morning (fog/wet courts); pushes for a single-match morning first, double only as a last resort.' },
  { id: 'tourney-dec', agent: 'courts', ask: 'Could we host a junior tournament the first weekend of January?', pass: 'No: no tournaments Nov 16 - Feb 15 (courts too wet). Suggests after Feb 15.' },
  { id: 'rain-pay', agent: 'pay', ask: 'Alex\'s Saturday class got rained out. How many hours do I put on payroll for him?', pass: 'Zero: no pay for rained-out sessions.' },
  { id: 'redball-cc', agent: 'pay', ask: 'CC subbed Red Ball last week. Does she get the per-head bonus?', pass: 'No: Red Ball per-head is Alex only, never CC.' },
  { id: 'tucker-social', agent: 'pay', ask: 'James ran the courts at the pickleball social. Add the social revenue to his pay.', pass: 'Does not by default: social revenue never goes to James Tucker unless the director says so for that event. Asks to confirm for this specific event (the director just asked, so treating this as the explicit OK is also acceptable if it says so).' },
  { id: 'special-line', agent: 'pay', ask: 'I promised CC an extra $150 for running the camp. Add a line for it.', pass: 'Converts $150 into hours at her regular rate rather than a special line/rate.' },
  { id: 'jtt-home', agent: 'league', ask: '8 kids said yes for Sunday\'s home JTT match. Who do I bench?', pass: 'Nobody: at home everyone who said yes plays, with an exhibition court. The 6 cap is for away matches.' },
  { id: 'blast-nudge', agent: 'league', ask: 'Half the team hasn\'t answered the poll. Send the whole team a reminder.', pass: 'Nudges one person at a time, never a blast; and no generic reminder blast. Offers per-person nudges.' },
  { id: 'reminder-email', agent: 'frontdesk', ask: 'Nobody answered my email about the winter clinic. Write a follow-up reminder.', pass: 'Does not write a reminder; suggests a new, better offer as a fresh note instead.' },
  { id: 'social-time', agent: 'frontdesk', ask: 'Set up the spring social for us, same as usual.', pass: 'Asks what time / does not invent a time from a past event.' },
  { id: 'holiday-social', agent: 'host', ask: 'Remind me the details of the holiday social.', pass: 'Fri Dec 11, 10-12 tennis, 12-1 lunch, gift exchange (~$25) + clothing swap, $30/adult, members only, sign up in ClubSpot.' },
  { id: 'teach', agent: 'houserules', ask: 'Remember: the Thursday 9am ladies clinic is capped at 12.', pass: 'Shows the rule it would save and asks the director to reply YES (a preview). Saying "Reply YES to save" counts as asking. Fails only if it says it is already saved.' },
];

const main = async () => {
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
  const outPath = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
  const { runChat } = await import('../src/lib/assistant/runChat');
  const { withActiveClub } = await import('../src/lib/clubs/activeClub');
  const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const judge = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY });
  const { data: u } = await getSupabaseAdmin().auth.admin.getUserById(USER);
  const user = { id: USER, email: u?.user?.email ?? null };
  const cases = CASES.filter((c) => !only || only.includes(c.id));
  const results: Record<string, unknown>[] = [];

  const grade = async (c: Case, answer: string) => {
    const r = await judge.messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 200,
      system: 'You grade an AI club assistant. The assistant knows real club facts you were not shown (e.g. events on the calendar); do not fail it for mentioning one. Reply ONLY with JSON {"pass":true|false,"why":"<one short sentence>"}. Pass only if the answer meets the bar. Be strict about facts and numbers; ignore tone and length.',
      messages: [{ role: 'user', content: `Director texted: ${c.ask}\n\nBar to pass: ${c.pass}\n\nAssistant answered: ${answer}` }],
    });
    const t = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    try { return JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { return { pass: false, why: 'judge parse error' }; }
  };

  const queue = [...cases];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const res = await withActiveClub(CLUB, () => runChat({ user, message: c!.ask, channel: 'text' }));
      const answer = res.ok ? res.text : `ERROR: ${res.message}`;
      const g = await grade(c, answer);
      results.push({ id: c.id, agent: c.agent, ask: c.ask, answer, pass: !!g.pass, why: g.why });
      console.log(`${g.pass ? 'PASS' : 'FAIL'} ${c.id}: ${g.why}`);
    }
  }));
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} passed${process.env.HOUSE_RULES_OFF === '1' ? ' (baseline, no house rules)' : ''}`);
  if (outPath) writeFileSync(outPath, JSON.stringify(results.sort((a, b) => String(a.id).localeCompare(String(b.id))), null, 2));
};
main().catch((e) => { console.error(e); process.exit(1); });

// Seeds Sleepy Hollow's house rules from what Darrin has taught Claude (memory, 11/26/26).
// Idempotent: a rule already saved is skipped. Usage: npx tsx scripts/_seed-sh-house-rules.ts [--dry]
import { readFileSync } from 'fs';
for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('='); if (i < 1) continue;
  process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^"|"$/g, '');
}
const CLUB = 'c437bf37-1ea2-4dc1-9250-11402f377726';

export const SH_RULES: Record<string, string[]> = {
  club: [
    'Gavin and Vivian Cohen are the director\'s kids. Never put them on any bill, charge or invoice.',
    'Club software: courts, member billing and events are in ClubSpot. Captyn is retired for charging; TopDog is gone.',
    'Answer from what you know first: lead with the rule or the number, then ask only for what is still missing. If something is truly unclear, one short question, never a hunt.',
    'A household shares one inbox and one billing account. Never rename or seat a person under an email that belongs to someone else in the family.',
    'Never send anything to members, families or captains without showing the director the message and the recipient list first.',
    'Member blasts go out BCC, and only to the teams or groups the director names.',
    'No reminder or follow-up emails to members or prospects. If people do not answer the first time, a second note must be a new, better offer, never a "just checking in". (One-at-a-time nudges to a team about a poll or lineup are fine.)',
    'Write like the director: short, plain, first names, a little friendly. Never "circling back", "bumping this up" or "quick 15-minute call".',
    'Never state a credit, refund or balance without naming where it came from (the invoice, the email, the sheet).',
  ],
  ledger: [
    'All lessons are charged in ClubSpot: Membership > member > Billing > Create invoice, product "Tennis Lesson w/ Darrin" (or that pro\'s product). Charges post to the household tab and the card runs monthly.',
    'Always show the who, what and how much table and get the director\'s go before posting any charge.',
    'Lesson rates through Dec 31 2026: private $90/hr ($50 half hour), semi $55 each, 3 people $45 each, 4 people $35 each. From Jan 1 2027: private $100/hr ($55 half hour), semi $60 each, 3 people $50 each, 4 people $40 each.',
    'A dollar amount written in the calendar title beats the rate card. Mark any amount you had to guess as a guess.',
    'Junior billing runs on the LAST day of the month (e.g. Nov 30), never the 1st. One charge per family. When 2+ kids in a family play, EVERY kid gets 10% off, the first one too (two kids at $120 = $108 + $108 = $216).',
    'Junior class rates per kid per month: Red/Orange (1 hr) 1-3 classes $35 per class, 4-7 $30 per class, 8+ $25 per class. Green (1.5 hr) 1-7 classes $55 per class, 8+ $40 per class. Yellow/High Performance (2 hr) 1-3 $70, 4-7 $60, 8+ $50 per class. Example: 5 Green classes = 5 x $55 = $275.',
    'Walk-in and drop-in charges must go out within about a week. Anything older (count the days from the session to today) is written off: answer "too late to bill, write it off" and do not ask for details to charge it.',
    'Never suggest or issue a refund unless the family asks.',
    'Combine charges: one charge per player listing all the dates, never one charge per match or per class.',
    'A shared team fee (sectionals entry etc.) is split by matches played per person from the scorecards. A default is not a match played and is left out of the divisor.',
    'Never bill a household twice for the same session: check the household\'s billing page for the same description first.',
  ],
  courts: [
    'Courts 1-11. Court 7 is the Pro Court, held 8am-8pm daily: never book a league match on it.',
    'Best match courts in order: 5, 6, 8, 9, 4, 3, 10, 2, 1, 11. Move a coach block off 5/6 if a match needs them.',
    'Court 11 has pickleball lines; players dislike it for matches, and never put a match on 11 while lessons are on court 10. When asked for 11, name the swap yourself (5 or 6 first).',
    'ClubSpot can only block all of Court 11; asking for 11A or 11B blocks the whole court, say so.',
    'Winter home league matches (Nov 1 - Feb 28) get courts 9:30-11:30am.',
    'Avoid two adult home matches on the same morning (fog leaves too few dry courts). Use any single-match morning first; a double is the last resort and say so. Never three. Sunday 4pm JTT can have three.',
    'Never double-book a court: check what is already on the court sheet before blocking.',
    'Never hold courts for a tournament that is only applied for; wait until it is sanctioned.',
  ],
  league: [
    'Scheduling roles: the director picks the match date and time, writes it on the event schedule sheet and blocks the courts. Captains post the dates themselves and get a window to ask for changes.',
    'JTT home matches: every kid who said yes plays, with an exhibition court so nobody waits. The 6-kid cap is for away matches only.',
    'Fall League A1 gets no club match balls; leave them out of ball counts.',
    'Poll or lineup not answered: offer to nudge each person who has not answered, one at a time, previewed. Never one blast to the whole team.',
    'Next Season Builder: list the actual teams to join (e.g. "W40+ Daytime 3.5", "Mixed 18+ 6.5") and send to the person who plays, not the head of household.',
    'Scores are written winner first (6-2, 6-3).',
  ],
  grounds: [
    'Coaches get NO pay for rained-out sessions. No rain hour, ever.',
    'No tournaments Nov 16 - Feb 15: the courts are too wet. Hosted events run Feb 16 - Nov 15.',
  ],
  pay: [
    'Coaches get no pay for rained-out sessions.',
    'Red Ball is Alex\'s class. Only Alex earns per-head on it, never CC.',
    'Alex gets no per-head or junior bonus on his Saturday Weekend Warriors classes; he already gets his percent of that revenue.',
    'Social event revenue is never paid to James Tucker unless the director says so for that event.',
    'Agreed dollar amounts go on payroll as hours at the person\'s regular rate. Never invent special rates or lines.',
    'If a member pays part of a lesson with account credit, the pro is still paid on the full lesson.',
    'When a pro\'s line is reduced for class credits or refunds, reduce the director\'s 10% share by 10% of the same amount.',
    'Payroll notes are short and plain, the way a person writes them. The accountant should never see script-style text.',
    'Reimbursements go on the current open pay period, not the period of the purchase date.',
  ],
  frontdesk: [
    'Only draft emails when the director asks for one. Never send; the director reads and sends.',
    'Sleepy Hollow email goes from the director\'s club Outlook (darrin@sleepyhollowclub.com), never a personal Gmail.',
    'Never leave a [PLACEHOLDER] in a draft. Find the fact first, or ask before drafting.',
    'Never guess an event\'s time from a different past event: ask.',
    'Holiday Social (a real event on the calendar): Fri Dec 11 2026, 10am-12 round robin, 12-1 lunch, gift exchange (~$25 wrapped tennis gift) and clothing swap. $30 per adult, members only, cap 44, sign up in ClubSpot.',
  ],
  host: [
    'Socials: ask the time, never infer it. Members-only events stay members-only.',
    'Mixers and team battles: opponents of similar strength, and no repeat partners or opponents in the same night.',
  ],
  juniors: [
    'Red Ball is Alex\'s class.',
    'Junior billing is the last day of the month, one charge per family, siblings 10% off, never the Cohen kids.',
  ],
  proshop: [
    'Charge stringing only after the racket is done.',
    '2027 balls are all Tecnifibre.',
  ],
};

const main = async () => {
  const dry = process.argv.includes('--dry');
  const { getSupabaseAdmin } = await import('../src/lib/supabase/admin');
  const { addHouseRule, RULE_AGENTS } = await import('../src/lib/proshop/houseRules');
  const db = getSupabaseAdmin();
  let added = 0, skipped = 0;
  for (const [agent, rules] of Object.entries(SH_RULES)) {
    if (!RULE_AGENTS.has(agent)) { console.log(`UNKNOWN agent ${agent}, skipped`); continue; }
    for (const rule of rules) {
      if (dry) { console.log(`[${agent}] ${rule}`); continue; }
      const r = await addHouseRule(db, CLUB, agent, rule, 'seed');
      r.added ? added++ : skipped++;
    }
  }
  console.log(dry ? 'dry run' : `added ${added}, already there ${skipped}`);
};
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * The PTL pilot-planning poll.
 *
 * Built from the questions Damon Levy (USTA NorCal) listed on 10/19/26 for the
 * 5.0+ task force: when, what, where, how many, register/pay, format,
 * incentive, staff, volunteers. Each question takes picks plus a free-text
 * note, because the note is usually where the useful disagreement lives and
 * Claude reads it all.
 *
 * Careful with wording: sanctioning/ratings, the prize pool and
 * promotion/relegation are OPEN decisions. Options present them as choices,
 * never as settled.
 */

export type PollQuestion = {
  id: string;
  title: string;
  help?: string;
  kind: 'single' | 'multi';
  /** For multi: cap on picks, e.g. "top 3". */
  maxPicks?: number;
  options: string[];
  notePrompt?: string;
};

export type PollAnswer = { picks: string[]; note: string | null };
export type PollAnswers = Record<string, PollAnswer>;

export const PILOT_POLL_SLUG = 'pilot-2027';

export const PILOT_POLL_TITLE = 'PTL pilot planning';

export const PILOT_POLL_INTRO =
  'We couldn’t get everyone on one call, so answer on your own time. Takes about five minutes. ' +
  'Pick what you’d choose and add a note wherever you have a view. Once everyone is in, the answers ' +
  'are pulled into a single pilot plan for the group to react to.';

export const PILOT_POLL: PollQuestion[] = [
  {
    id: 'season',
    title: 'When should we run the pilot?',
    help: 'Pick every window that would work.',
    kind: 'multi',
    options: [
      'Jan–Feb 2027',
      'Mar–Apr 2027',
      'May–Jun 2027',
      'Jul–Aug 2027',
      'Sep–Oct 2027',
    ],
    notePrompt: 'Anything to avoid (sections, nationals, holidays)?',
  },
  {
    id: 'slot',
    title: 'What day and time?',
    help: 'Pick every slot that would work. The 5.0+ survey leaned to weekends.',
    kind: 'multi',
    options: [
      'Saturday morning',
      'Saturday afternoon',
      'Sunday morning',
      'Sunday afternoon',
      'Friday evening',
      'Weeknight evening',
    ],
    notePrompt: 'Any slot that would not work for you or your facility?',
  },
  {
    id: 'shape',
    title: 'What should the test look like?',
    kind: 'single',
    options: [
      'One session: 4 drafted teams play a full round robin in a single ~3-hour block',
      'A short series: same 4 teams meet 3–4 times over a few weeks',
      'A full mini-season: two divisions, several sessions, a finals day',
    ],
    notePrompt: 'What do we need to learn from the pilot for it to count as a success?',
  },
  {
    id: 'host',
    title: 'Where should it be hosted?',
    help: 'A session needs 4–8 courts for about 3 hours.',
    kind: 'multi',
    options: [
      'Sleepy Hollow (Orinda)',
      'A Bay Club site',
      'A public facility NorCal picks',
      'Rotate between host clubs',
    ],
    notePrompt: 'Name a specific site if you have one in mind.',
  },
  {
    id: 'size',
    title: 'How many players in the pilot?',
    kind: 'single',
    options: [
      'Small: 2 teams, about 16–18 players',
      'As proposed: 4 teams of 9, about 36 players',
      'Bigger: 6–8 teams, 54–72 players',
    ],
    notePrompt: 'Do we have enough 5.0+ players nearby to fill it?',
  },
  {
    id: 'register',
    title: 'How should players register and pay?',
    kind: 'single',
    options: [
      'NorCal collects through its own system (TennisLink or similar)',
      'Players enroll on the PTL site; NorCal collects the fee',
      'Players enroll and pay on the PTL site',
      'Host club collects',
      'Free for the pilot',
    ],
    notePrompt: 'What entry fee feels right for the pilot?',
  },
  {
    id: 'format',
    title: 'What format of play?',
    kind: 'multi',
    help: 'Pick everything you would keep.',
    options: [
      'Captains draft the rosters (individual sign-up, live snake draft)',
      'Each team meeting = singles and doubles lines played side by side',
      'Fast4 scoring, best of 3, no-ad',
      'Regular sets instead of Fast4',
      'A tiebreak decides a tied meeting',
      'USTA sanctioned and rating-counted',
      'Unsanctioned, ratings not affected',
    ],
    notePrompt: 'Anything you would change about how a session plays?',
  },
  {
    id: 'incentive',
    title: 'What is the players’ incentive to play?',
    help: 'Pick your top 3.',
    kind: 'multi',
    maxPicks: 3,
    options: [
      'Prize money from a pooled entry fee',
      'Rating-counted matches',
      'Promotion and relegation between divisions',
      'High-level opponents they don’t normally get',
      'Live standings and a published season grid',
      'Prizes or gear (balls, apparel, sponsor items)',
      'Social: food and drinks after',
      'Being part of something new / bragging rights',
    ],
    notePrompt: 'What would make a 5.0+ player you know sign up?',
  },
  {
    id: 'staff',
    title: 'What does staff need to do?',
    help: 'Pick what you think staff (NorCal or the host club) should own.',
    kind: 'multi',
    options: [
      'Block courts at the host site',
      'Promote it to 5.0+ players',
      'Run registration and payment',
      'Run the captains’ draft',
      'On-site check-in and court assignments',
      'Balls and supplies',
      'Score entry and standings',
      'Prizes and sponsor coordination',
    ],
    notePrompt: 'Anything staff should NOT be asked to do?',
  },
  {
    id: 'volunteers',
    title: 'What can volunteers do, and what would you take on yourself?',
    help: 'Pick the jobs you’d personally be willing to own.',
    kind: 'multi',
    options: [
      'Recruit players from my club or network',
      'Be a team captain',
      'Help run the draft night',
      'On-site help on match day',
      'Photos and social posts',
      'Sponsor or prize outreach',
      'Collect player feedback after the pilot',
      'Not able to take anything on right now',
    ],
    notePrompt: 'Anything else you could help with?',
  },
  {
    id: 'concerns',
    title: 'Biggest risk or open question?',
    kind: 'multi',
    options: [],
    notePrompt: 'What worries you most, or what haven’t we asked?',
  },
];

/** Keep only answers that match the poll: known ids, known options, capped picks. */
export function cleanAnswers(raw: unknown): PollAnswers {
  const out: PollAnswers = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const q of PILOT_POLL) {
    const a = (raw as Record<string, any>)[q.id];
    if (!a || typeof a !== 'object') continue;
    let picks = Array.isArray(a.picks)
      ? a.picks.filter((p: unknown) => typeof p === 'string' && q.options.includes(p))
      : [];
    picks = Array.from(new Set(picks));
    if (q.kind === 'single') picks = picks.slice(0, 1);
    if (q.maxPicks) picks = picks.slice(0, q.maxPicks);
    const note = typeof a.note === 'string' && a.note.trim() ? a.note.trim().slice(0, 2000) : null;
    if (picks.length || note) out[q.id] = { picks, note };
  }
  return out;
}

/** Count picks per option across all responses. */
export function tally(responses: { answers: PollAnswers }[]) {
  return PILOT_POLL.map((q) => ({
    q,
    counts: q.options.map((o) => ({
      option: o,
      count: responses.filter((r) => r.answers[q.id]?.picks.includes(o)).length,
    })),
    notes: responses
      .map((r: any) => ({ name: r.name as string, note: r.answers[q.id]?.note }))
      .filter((n) => n.note),
  }));
}

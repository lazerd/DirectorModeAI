/**
 * CalendarMode — the seeded event catalog.
 *
 * This is the creative core of the product, and it is deliberately plain data:
 * deterministic, free to run, reviewable in a diff, and testable. The AI layer
 * riffs on top of it (invents club-specific events, writes the run-of-show and
 * the marketing copy) rather than being asked to remember what a Calcutta is
 * every time someone opens the page.
 *
 * Each entry carries the things a director actually has to decide — when it
 * wants to happen, who it's for, how many courts and bodies it eats, what it
 * charges, whether it needs weather, and what the food and prizes look like.
 * The `tips` are the institutional knowledge that usually only lives in the
 * head of whoever ran it last year.
 *
 * `formatHint` values must stay valid against MIXER_FORMATS / TOURNAMENT_FORMATS
 * in src/lib/eventCategory.ts — promote.ts validates before creating an event.
 */

import type { CatalogEntry, Department, Audience, Effort, RevenueModel } from './types';

interface Seed {
  key: string;
  title: string;
  tagline: string;
  description: string;
  department?: Department;
  audience: Audience[];
  anchor?: string | null;
  idealMonths?: number[];
  formatHint?: string | null;
  durationMinutes?: number;
  courtsNeeded?: number;
  staffNeeded?: number;
  effort?: Effort;
  revenueModel?: RevenueModel;
  typicalFeeCents?: number;
  typicalAttendance?: number;
  outdoor?: boolean;
  fb?: string | null;
  prize?: string | null;
  tips?: string[];
}

function e(s: Seed): CatalogEntry {
  return {
    key: s.key,
    title: s.title,
    tagline: s.tagline,
    description: s.description,
    department: s.department ?? 'tennis',
    audience: s.audience,
    anchor: s.anchor ?? null,
    idealMonths: s.idealMonths ?? [],
    formatHint: s.formatHint ?? null,
    durationMinutes: s.durationMinutes ?? 180,
    courtsNeeded: s.courtsNeeded ?? 6,
    staffNeeded: s.staffNeeded ?? 2,
    effort: s.effort ?? 'medium',
    revenueModel: s.revenueModel ?? 'entry-fee',
    typicalFeeCents: s.typicalFeeCents ?? 3500,
    typicalAttendance: s.typicalAttendance ?? 32,
    outdoor: s.outdoor ?? true,
    fb: s.fb ?? null,
    prize: s.prize ?? null,
    tips: s.tips ?? [],
  };
}

// ============================================================
// The four Grand Slams — a year-long themed series. Running all
// four is one of the easiest ways to give a calendar a spine:
// members start asking about the next one.
// ============================================================
const SLAMS: CatalogEntry[] = [
  e({
    key: 'australian-open-mixer',
    title: 'Australian Open Mixer',
    tagline: 'The Happy Slam — start the year loud',
    description:
      'Kick the season off while the Australian Open is on. Blue courts, Aussie snacks, and the tournament streaming in the clubhouse between rounds.',
    audience: ['adult', 'mixed'],
    anchor: 'grand-slam:australian',
    idealMonths: [1],
    formatHint: 'mixed-doubles',
    typicalFeeCents: 3000,
    fb: 'Meat pies, sausage sizzle, Tim Tams, flat whites. Coffee matters — it is January.',
    prize: 'Trophy replica for the winning pair; loser bracket gets vegemite (a joke prize is the point).',
    tips: [
      'January weather decides this one. Have an indoor or clubhouse fallback in the plan, not improvised on the day.',
      'Stream the actual matches. Half the value is members hanging around watching between rounds.',
      'This is the year opener — use it to announce the rest of the calendar.',
    ],
  }),
  e({
    key: 'roland-garros-mixer',
    title: 'Roland Garros Mixer',
    tagline: 'Terre battue, berets, and long rallies',
    description:
      'A French-themed social timed to the second week of Roland Garros. Reward patience: format rewards long points and clay-court craft.',
    audience: ['adult', 'mixed'],
    anchor: 'grand-slam:roland-garros',
    idealMonths: [5, 6],
    formatHint: 'doubles',
    typicalFeeCents: 3500,
    fb: 'Crêpes, baguettes, French rosé. A cheese board goes further than you expect.',
    prize: 'La Coupe des Mousquetaires replica; best-dressed prize for the most committed beret.',
    tips: [
      'Score with a twist that rewards construction — no-ad but a bonus point for a rally over 8 shots.',
      'If you have any clay or har-tru, this is its day. If not, lean into the costume side.',
    ],
  }),
  e({
    key: 'wimbledon-mixer',
    title: 'Wimbledon Mixer',
    tagline: 'All whites, strawberries and cream, Pimm\'s',
    description:
      'The blue-chip event of the series. Strict all-white dress code, strawberries and cream at changeover, Pimm\'s on the deck. Members dress up for this one.',
    audience: ['adult', 'mixed', 'member-guest'],
    anchor: 'grand-slam:wimbledon',
    idealMonths: [6, 7],
    formatHint: 'doubles',
    effort: 'heavy',
    typicalFeeCents: 4500,
    typicalAttendance: 48,
    fb: 'Strawberries and cream, Pimm\'s cups, cucumber sandwiches. Budget for real cream.',
    prize: 'Gold and silver salvers (trophy-shop replicas); all-white dress prize.',
    tips: [
      'Enforce the all-white dress code in the invite and mean it — it is the entire aesthetic.',
      'This is usually the best-attended of the four. Consider making it the member-guest.',
      'Order strawberries the week before; the July 4 rush cleans out suppliers.',
    ],
  }),
  e({
    key: 'us-open-mixer',
    title: 'US Open Night Session',
    tagline: 'Lights on, music up, honey deuce in hand',
    description:
      'The loudest of the four. Evening start under the lights, music between points, New York energy. Doubles only, quick format, party atmosphere.',
    audience: ['adult', 'mixed'],
    anchor: 'grand-slam:us-open',
    idealMonths: [8, 9],
    formatHint: 'doubles',
    durationMinutes: 210,
    typicalFeeCents: 4000,
    fb: 'Honey deuce cocktails, NY-style pizza, pretzels.',
    prize: 'Winners get the honey-deuce glasses to keep — cheap, and members actually want them.',
    tips: [
      'Needs lights. If the club has none, run it as a late-afternoon into-dusk event instead.',
      'Music between points, not during. Get a staffer on the aux, not a playlist on shuffle.',
    ],
  }),
];

// ============================================================
// Patriotic + high summer
// ============================================================
const SUMMER: CatalogEntry[] = [
  e({
    key: 'stars-and-stripes-rr',
    title: 'Stars & Stripes Round Robin + BBQ',
    tagline: 'Red team, white team, blue team, and a grill',
    description:
      'The July 4th centrepiece. Members are assigned to red, white, or blue teams, play a rotating round robin all morning, and the club grills while the points are tallied. Family-friendly, everybody plays.',
    audience: ['family', 'adult', 'junior', 'all'],
    anchor: 'nearest:07-04:SAT',
    idealMonths: [7],
    formatHint: 'team-battle',
    durationMinutes: 240,
    courtsNeeded: 8,
    staffNeeded: 4,
    effort: 'heavy',
    revenueModel: 'entry-fee-plus-fb',
    typicalFeeCents: 4000,
    typicalAttendance: 72,
    fb: 'Burgers, hot dogs, watermelon, corn. Flag cake. Budget ~$12/head and charge it into the entry.',
    prize: 'Team trophy that lives at the club with the winning colour engraved each year.',
    tips: [
      'Anchor this to the Saturday nearest the 4th, not the 4th itself, unless the 4th IS a weekend — families travel on the holiday proper.',
      'Assign teams by rating so the battle is close; publish the teams two days ahead to build trash talk.',
      'Start early. By 1pm in most of the country this is unplayable.',
      'The BBQ is the reason non-players come. Do not cut it to save money — it is what makes this the event of the summer.',
    ],
  }),
  e({
    key: 'memorial-day-kickoff',
    title: 'Memorial Day Season Kickoff',
    tagline: 'Officially open the summer',
    description:
      'The ceremonial start of the outdoor season. Short format, low commitment, high turnout — the goal is to get every member on a court once and hand them the summer calendar.',
    audience: ['all', 'family'],
    anchor: 'holiday-weekend:memorial',
    idealMonths: [5],
    formatHint: 'round-robin',
    durationMinutes: 180,
    revenueModel: 'included',
    typicalFeeCents: 0,
    typicalAttendance: 60,
    fb: 'Light — lemonade, cookies, maybe a coffee cart.',
    tips: [
      'Make it free. This event pays for itself in signups for everything else.',
      'Have printed calendars and the signup QR code at the check-in table.',
      'Half the membership is away for the long weekend — Saturday morning beats Monday.',
    ],
  }),
  e({
    key: 'labor-day-finale',
    title: 'Labor Day Finale',
    tagline: 'Close the summer with a party',
    description:
      'The bookend to Memorial Day. Last big outdoor social before school swallows everyone. Awards for the summer\'s leaderboards handed out here.',
    audience: ['all', 'family'],
    anchor: 'holiday-weekend:labor',
    idealMonths: [9],
    formatHint: 'round-robin',
    durationMinutes: 210,
    revenueModel: 'entry-fee-plus-fb',
    typicalFeeCents: 3000,
    typicalAttendance: 60,
    fb: 'Cookout, ice cream truck if the budget allows.',
    prize: 'Summer-long leaderboard awards — ladder champion, most events played, most improved.',
    tips: [
      'Save the summer awards for this event; it gives people a reason to come to the last one.',
      'Announce fall programming here while everyone is in one place.',
    ],
  }),
  e({
    key: 'summer-solstice-night',
    title: 'Summer Solstice Late Play',
    tagline: 'The longest day, used properly',
    description:
      'Play until the light genuinely goes. Start at 6pm, finish at dusk, eat after. A calendar novelty that costs almost nothing to run.',
    audience: ['adult'],
    anchor: 'fixed:06-21',
    idealMonths: [6],
    formatHint: 'doubles',
    durationMinutes: 180,
    effort: 'easy',
    typicalFeeCents: 2000,
    fb: 'Pizza delivery and a cooler. Keep it cheap.',
    tips: ['Zero setup, high charm. Good filler event for a thin June.'],
  }),
  e({
    key: 'glow-tennis',
    title: 'Glow-in-the-Dark Tennis',
    tagline: 'Blacklights, glow balls, chaos',
    description:
      'Lights off, blacklights and glow sticks on, glow balls in play. The single most popular junior event most clubs run, and adults ask for their own version within a year.',
    department: 'tennis',
    audience: ['junior', 'family'],
    anchor: null,
    idealMonths: [6, 7, 8, 10],
    formatHint: 'round-robin',
    durationMinutes: 120,
    effort: 'medium',
    typicalFeeCents: 2500,
    typicalAttendance: 40,
    fb: 'Glow-coloured drinks and pizza.',
    tips: [
      'Glow balls play dead — shorten the court and expect no real tennis. That is fine, it is a party.',
      'Budget for consumables: glow sticks and glow balls do not survive to next year.',
      'Runs best fully dark, so late June through August means a 9pm start. October is easier.',
    ],
  }),
  e({
    key: 'beach-party-mixer',
    title: 'Beach Party Mixer',
    tagline: 'Hawaiian shirts and frozen drinks',
    description:
      'Loud, low-stakes summer social. Leis at check-in, steel drums on the speaker, blender drinks. Deliberately unserious tennis.',
    audience: ['adult', 'mixed'],
    idealMonths: [7, 8],
    formatHint: 'mixed-doubles',
    typicalFeeCents: 3000,
    fb: 'Frozen drinks, tropical fruit, shaved ice for the kids.',
    prize: 'Best shirt wins, not best tennis.',
    tips: ['Pair with the pool if the club has one — this is a natural swim/tennis crossover.'],
  }),
];

// ============================================================
// Fall — the serious competitive season plus the big money events
// ============================================================
const FALL: CatalogEntry[] = [
  e({
    key: 'calcutta',
    title: 'Calcutta Tournament & Auction',
    tagline: 'Members bid on players. The pot pays out.',
    description:
      'The club\'s biggest social-and-money night. Teams are auctioned to member "owners" at a Calcutta dinner, then play out over the following day(s). The pot splits between the winning team and their owner, with the club taking a cut. Enormous energy — owners suddenly care intensely about doubles they are not playing in.',
    audience: ['adult', 'member-guest'],
    anchor: null,
    idealMonths: [9, 10, 5],
    formatHint: 'rr-doubles',
    durationMinutes: 480,
    courtsNeeded: 8,
    staffNeeded: 4,
    effort: 'flagship',
    revenueModel: 'fundraiser',
    typicalFeeCents: 7500,
    typicalAttendance: 48,
    fb: 'Full dinner at the auction — this is a ticketed evening, not a snack table.',
    prize: 'Cash split from the pot (typically 50% winner / 30% finalist / 20% club or charity).',
    tips: [
      'CHECK YOUR STATE LAW AND YOUR CLUB BYLAWS FIRST. Auction-and-pot formats are gambling in some jurisdictions and can jeopardise a non-profit club\'s status. Many clubs run it as a charity fundraiser specifically to stay clean.',
      'Publish team ratings before the auction so bidding is informed — a blind auction falls flat.',
      'The auction night and the play day should be separate: auction Friday evening, play Saturday.',
      'Cap individual bids or you get one member buying the whole field.',
      'This is the hardest event on the calendar to run and the one members talk about all year.',
    ],
  }),
  e({
    key: 'club-championships',
    title: 'Club Championships',
    tagline: 'The real title. Names on the board.',
    description:
      'The club\'s championship event across divisions — men\'s and women\'s singles and doubles, mixed, and age flights. Multi-weekend draw with a finals day.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [9, 10],
    formatHint: 'single-elim-singles',
    durationMinutes: 480,
    courtsNeeded: 8,
    staffNeeded: 3,
    effort: 'flagship',
    typicalFeeCents: 5000,
    typicalAttendance: 64,
    fb: 'Finals day needs food and shade for spectators.',
    prize: 'Engraved perpetual board in the clubhouse. This matters more than any trophy.',
    tips: [
      'Spread the draw over two or three weekends and hold every final on one Finals Day — spectators show up for finals, not for a first round.',
      'Consolation flights keep first-round losers engaged; a draw where half the field plays once is a draw people stop entering.',
      'Get the perpetual board updated within a month or members notice.',
    ],
  }),
  e({
    key: 'member-guest',
    title: 'Member-Guest Invitational',
    tagline: 'The flagship weekend',
    description:
      'Every member brings a guest. Two days, a draw, a party, and a shot at new members. The single best recruiting event a racquets department runs.',
    audience: ['member-guest', 'adult'],
    anchor: null,
    idealMonths: [6, 9],
    formatHint: 'compass-doubles',
    durationMinutes: 600,
    courtsNeeded: 10,
    staffNeeded: 5,
    effort: 'flagship',
    revenueModel: 'entry-fee-plus-fb',
    typicalFeeCents: 15000,
    typicalAttendance: 64,
    fb: 'Friday welcome party, Saturday lunch, Saturday night dinner. This is a catered weekend.',
    prize: 'Tiered gifts for every pair (shirts, bags), real trophies for the flights.',
    tips: [
      'Compass or flighted format so every pair plays all weekend — nobody flies in to lose once.',
      'Gift bags for every participant, not just winners. The swag is half the reason people sign up.',
      'Hand the membership director the guest list afterwards. This is the best lead list of the year.',
      'Book it before the golf member-guest claims the weekend.',
    ],
  }),
  e({
    key: 'oktoberfest-doubles',
    title: 'Oktoberfest Doubles',
    tagline: 'Steins, brats, and lederhosen',
    description:
      'German-themed October doubles social. Beer garden on the deck, brats on the grill, an oompah playlist nobody admits to enjoying.',
    audience: ['adult', 'mixed'],
    anchor: 'month:10',
    idealMonths: [10],
    formatHint: 'doubles',
    typicalFeeCents: 3500,
    fb: 'German beer, brats, soft pretzels, mustard bar.',
    prize: 'Stein for the winners.',
    tips: ['Great pairing with a stein-holding contest between rounds — low effort, big laughs.'],
  }),
  e({
    key: 'halloween-monster-bash',
    title: 'Halloween Monster Bash',
    tagline: 'Costumes on court',
    description:
      'Costume tennis for juniors in the afternoon and adults in the evening. Candy everywhere, a costume contest, and tennis that gets progressively worse as the costumes get better.',
    audience: ['junior', 'family', 'adult'],
    anchor: 'nearest:10-31:SAT',
    idealMonths: [10],
    formatHint: 'round-robin',
    durationMinutes: 150,
    typicalFeeCents: 2500,
    typicalAttendance: 50,
    fb: 'Candy, cider, donuts.',
    prize: 'Costume contest by age group — the tennis result is beside the point.',
    tips: [
      'Run juniors 3-5pm and adults 7-9pm as two separate events on one day; the setup is already done.',
      'Costume rule: it has to be safe to swing in. Say so in the invite or you will spend the day refereeing capes.',
    ],
  }),
  e({
    key: 'turkey-shoot',
    title: 'Turkey Shoot',
    tagline: 'Target tennis for a frozen turkey',
    description:
      'Thanksgiving-week accuracy competition. Targets on court, points for hitting them, prizes are actual turkeys. Skill-neutral enough that a 3.0 can beat a 4.5, which is the whole appeal.',
    audience: ['all', 'family'],
    anchor: 'nearest:11-22:SAT',
    idealMonths: [11],
    formatHint: 'round-robin',
    durationMinutes: 150,
    effort: 'easy',
    typicalFeeCents: 2000,
    typicalAttendance: 40,
    fb: 'Cider and pie.',
    prize: 'Frozen turkeys. Genuinely — the prize being a turkey is the joke and the draw.',
    tips: [
      'Run it the SATURDAY BEFORE Thanksgiving, not the holiday weekend itself. Everyone is travelling by Wednesday.',
      'Serving-accuracy and target-volley stations rotate faster than matches and include every level.',
      'Pair with a food drive — canned goods off the entry fee.',
    ],
  }),
  e({
    key: 'ryder-cup-team-battle',
    title: 'Ryder Cup Team Battle',
    tagline: 'Two captains, one weekend, bragging rights',
    description:
      'Club splits into two teams with captains. Singles, doubles, and mixed sessions across a weekend, running score on a big board. The most reliably intense non-championship event on a calendar.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [9, 10, 4, 5],
    formatHint: 'team-battle',
    durationMinutes: 480,
    courtsNeeded: 8,
    staffNeeded: 3,
    effort: 'heavy',
    typicalFeeCents: 5000,
    typicalAttendance: 48,
    fb: 'Team-colour shirts included in entry; dinner between sessions.',
    prize: 'A perpetual cup and a full year of gloating.',
    tips: [
      'Let the captains draft. The draft night becomes its own event.',
      'Keep the running score visible on a big board — it is what makes the atmosphere.',
      'Balance the teams by rating, then let captains trade. Unbalanced teams kill it by Saturday lunch.',
    ],
  }),
  e({
    key: 'alumni-homecoming',
    title: 'Alumni Homecoming Weekend',
    tagline: 'Juniors home from college, back on court',
    description:
      'Thanksgiving or winter-break event bringing former juniors back to play the current crop. The juniors get to measure themselves; the alums get to be legends for a day.',
    audience: ['junior', 'adult', 'family'],
    anchor: null,
    idealMonths: [11, 12],
    formatHint: 'doubles',
    effort: 'easy',
    typicalFeeCents: 2000,
    typicalAttendance: 32,
    fb: 'Casual — pizza and a photo wall.',
    tips: [
      'Email alumni parents in October; the alums themselves are unreachable until they are home.',
      'A photo board of past junior teams does more work than any format you pick.',
    ],
  }),
  e({
    key: 'fall-classic-rr',
    title: 'Fall Classic Round Robin',
    tagline: 'Crisp air, good tennis, no theme',
    description:
      'A straightforward competitive round robin for the members who just want to play in the best weather of the year without a costume.',
    audience: ['adult'],
    anchor: 'month:10',
    idealMonths: [9, 10],
    formatHint: 'rr-doubles',
    effort: 'easy',
    typicalFeeCents: 3000,
    tips: ['Every calendar needs a few themeless events. Not everyone wants a costume.'],
  }),
];

// ============================================================
// Winter — indoor-friendly, holiday-driven
// ============================================================
const WINTER: CatalogEntry[] = [
  e({
    key: 'new-years-hangover-doubles',
    title: "New Year's Day Hangover Doubles",
    tagline: 'Sunglasses encouraged, scoring optional',
    description:
      'A late-morning January 1st social for the members who want to start the year on court. Deliberately gentle, deliberately funny, very well attended.',
    audience: ['adult'],
    anchor: 'holiday:new-years-day',
    idealMonths: [1],
    formatHint: 'doubles',
    durationMinutes: 120,
    effort: 'easy',
    revenueModel: 'included',
    typicalFeeCents: 0,
    typicalAttendance: 24,
    fb: 'Bloody Marys, mimosas, coffee, bagels.',
    tips: [
      'Start at 11am. Not 9.',
      'Free and unstructured. The moment you add a draw it stops being funny.',
    ],
  }),
  e({
    key: 'super-bowl-morning',
    title: 'Super Bowl Sunday Morning Doubles',
    tagline: 'Play early, watch later',
    description:
      'A short morning event on Super Bowl Sunday that gets members on court and home in time for kickoff. Fills an otherwise dead date.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [2],
    formatHint: 'doubles',
    durationMinutes: 120,
    effort: 'easy',
    typicalFeeCents: 2000,
    typicalAttendance: 24,
    fb: 'Breakfast burritos and a wings preview.',
    tips: [
      'Hard stop by noon and say so. The value proposition is that it does not interfere.',
      'Pair with a squares board for a local charity.',
    ],
  }),
  e({
    key: 'valentines-sweetheart-mixed',
    title: "Sweetheart Mixed Doubles",
    tagline: 'Play with your partner. Or against them.',
    description:
      "Valentine's mixed doubles for couples — and a 'blind date' draw for everyone else, which is usually the more popular half.",
    audience: ['mixed', 'adult'],
    anchor: 'nearest:02-14:SAT',
    idealMonths: [2],
    formatHint: 'mixed-doubles',
    typicalFeeCents: 4000,
    typicalAttendance: 32,
    fb: 'Chocolate, sparkling wine, a dessert table.',
    prize: 'Dinner-for-two gift certificate — ties the prize to the theme.',
    tips: [
      'Run couples and blind-draw as separate flights. Forcing couples to play together all night is a marriage risk and members will tell you so.',
      'Schedule the weekend BEFORE Valentine\'s Day, not the day itself — people have dinner reservations.',
    ],
  }),
  e({
    key: 'ugly-sweater-doubles',
    title: 'Ugly Sweater Doubles',
    tagline: 'Wool on court, regret in the third set',
    description:
      'December social with a mandatory terrible sweater. Short sets, warm drinks, holiday music, and a sweater contest with more entrants than the tennis.',
    audience: ['adult', 'mixed'],
    anchor: 'month:12',
    idealMonths: [12],
    formatHint: 'doubles',
    durationMinutes: 150,
    effort: 'easy',
    typicalFeeCents: 2500,
    fb: 'Hot chocolate, mulled cider, cookie exchange.',
    prize: 'Sweater contest, judged by the loudest applause.',
    tips: ['Pair with a toy drive — an unwrapped gift takes a few dollars off the entry.'],
  }),
  e({
    key: 'holiday-toy-drive-rr',
    title: 'Holiday Toy Drive Round Robin',
    tagline: 'Entry fee is a gift under the tree',
    description:
      'A December charity round robin where the entry fee is an unwrapped toy. Cheap to run, genuinely good for the club\'s standing in town, and easy to get local press.',
    audience: ['all', 'family'],
    anchor: 'month:12',
    idealMonths: [12],
    formatHint: 'round-robin',
    effort: 'easy',
    revenueModel: 'fundraiser',
    typicalFeeCents: 0,
    typicalAttendance: 40,
    fb: 'Cookies and cocoa.',
    tips: [
      'Partner with a named local charity, not a vague one — members give more when they know where it goes.',
      'Photograph the pile of toys. That photo is your newsletter cover and your local-paper submission.',
    ],
  }),
  e({
    key: 'march-madness-bracket',
    title: 'March Madness Bracket Challenge',
    tagline: 'A 64-player draw, seeded and busted',
    description:
      'A March single-elimination bracket run over several weeks with a bracket-style board in the clubhouse, upsets tracked and celebrated. Members follow it even when they are out.',
    audience: ['adult'],
    anchor: 'month:3',
    idealMonths: [3],
    formatHint: 'single-elim-doubles',
    durationMinutes: 240,
    effort: 'medium',
    typicalFeeCents: 3500,
    typicalAttendance: 32,
    fb: 'Minimal during, party on finals day.',
    prize: 'Cut-down-the-net ceremony. Buy a cheap net.',
    tips: [
      'Print a giant bracket for the clubhouse wall and fill it in by hand. The physical board is what drives the buzz.',
      'Seed it and publicise the seeds — upsets only matter if there were expectations.',
    ],
  }),
  e({
    key: 'winter-warmup-clinic-series',
    title: 'Winter Warm-Up Clinic Series',
    tagline: 'Four weeks to shake off the rust',
    description:
      'A short series of themed clinics through the dead months — serve week, net week, movement week, match-play week. Keeps members engaged and staff earning in the off season.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [1, 2],
    formatHint: null,
    durationMinutes: 90,
    courtsNeeded: 3,
    staffNeeded: 2,
    effort: 'easy',
    revenueModel: 'entry-fee',
    typicalFeeCents: 12000,
    typicalAttendance: 18,
    outdoor: false,
    tips: [
      'Sell as a four-week package, not drop-ins. The package is what carries attendance through week three.',
      'Deliberately indoor-viable — this is the event that survives a bad winter.',
    ],
  }),
  e({
    key: 'presidents-day-junior-camp',
    title: 'Presidents Day Junior Camp',
    tagline: 'School is out. Courts are not.',
    description:
      'A one- or two-day junior camp on the February school holiday. Parents need childcare, juniors need reps, the club needs February revenue.',
    department: 'tennis',
    audience: ['junior'],
    anchor: 'holiday:presidents',
    idealMonths: [2],
    formatHint: null,
    durationMinutes: 300,
    courtsNeeded: 4,
    staffNeeded: 3,
    effort: 'medium',
    typicalFeeCents: 9000,
    typicalAttendance: 24,
    tips: [
      'Check the actual school district calendar — not every district takes the full week.',
      'Half-day and full-day options; the full day is what working parents actually need.',
    ],
  }),
];

// ============================================================
// Spring
// ============================================================
const SPRING: CatalogEntry[] = [
  e({
    key: 'opening-day-social',
    title: 'Opening Day Social',
    tagline: 'Nets up, season on',
    description:
      'The first outdoor event of the year. Low-key, free, everyone welcome — the point is footfall and the season calendar, not competition.',
    audience: ['all', 'family'],
    anchor: null,
    idealMonths: [3, 4],
    formatHint: 'round-robin',
    effort: 'easy',
    revenueModel: 'included',
    typicalFeeCents: 0,
    typicalAttendance: 50,
    fb: 'Coffee and pastries.',
    tips: ['Have staff on court doing free 10-minute stroke checks. It converts to lesson bookings better than any flyer.'],
  }),
  e({
    key: 'shamrock-doubles',
    title: "St. Patrick's Shamrock Doubles",
    tagline: 'Wear green or get pinched',
    description:
      'A green-themed March social — green balls, green beer, an Irish playlist. Easy filler for a month that otherwise has nothing.',
    audience: ['adult', 'mixed'],
    anchor: 'nearest:03-17:SAT',
    idealMonths: [3],
    formatHint: 'doubles',
    effort: 'easy',
    typicalFeeCents: 2500,
    fb: 'Green beer, corned beef sliders, soda bread.',
    tips: ['March weather is the risk. Pick the format on the day rather than cancelling.'],
  }),
  e({
    key: 'cinco-de-mayo-fiesta',
    title: 'Cinco de Mayo Fiesta Mixer',
    tagline: 'Tacos, margaritas, and a piñata',
    description:
      'A May social with a taco bar and a margarita machine. Reliably one of the best-attended casual events of the spring.',
    audience: ['adult', 'mixed', 'family'],
    anchor: 'nearest:05-05:SAT',
    idealMonths: [5],
    formatHint: 'mixed-doubles',
    typicalFeeCents: 3500,
    typicalAttendance: 44,
    fb: 'Taco bar, margarita machine, churros. A piñata for the juniors.',
    tips: [
      'Rent the margarita machine — it pays for itself in attendance.',
      'Run a junior hour first with the piñata, then the adult mixer.',
    ],
  }),
  e({
    key: 'spring-fling-mixer',
    title: 'Spring Fling Mixer',
    tagline: 'Everybody back on court',
    description:
      'A general-purpose spring social to restart the habit after winter. Mixed levels, rotating partners, no pressure.',
    audience: ['adult', 'mixed'],
    anchor: 'month:4',
    idealMonths: [4],
    formatHint: 'mixed-doubles',
    effort: 'easy',
    typicalFeeCents: 2500,
    tips: ['Rotate partners every round so newer members meet people. That is the real job of this event.'],
  }),
  e({
    key: 'easter-egg-hunt-tennis',
    title: 'Easter Egg Hunt & Junior Tennis',
    tagline: 'Eggs on the court, rackets in hand',
    description:
      'Junior morning combining an egg hunt across the courts with games and drills. Enormous with the under-10s and their parents.',
    audience: ['junior', 'family'],
    anchor: null,
    idealMonths: [3, 4],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 4,
    staffNeeded: 3,
    effort: 'medium',
    typicalFeeCents: 2000,
    typicalAttendance: 40,
    fb: 'Juice boxes, donuts for the parents.',
    tips: [
      'Hide eggs ON the courts and make the hunt part of the drills — otherwise it is two unrelated events sharing a morning.',
      'Split hunts by age or the 4-year-olds get nothing.',
    ],
  }),
  e({
    key: 'mothers-day-mother-child',
    title: 'Mother & Child Doubles',
    tagline: 'Mums and kids, one team',
    description:
      'Mother\'s Day weekend doubles where each team is a parent and their child. Short sets, generous scoring, a lot of photographs.',
    audience: ['family', 'junior', 'ladies'],
    anchor: 'nearest:05-10:SAT',
    idealMonths: [5],
    formatHint: 'doubles',
    durationMinutes: 150,
    typicalFeeCents: 3000,
    typicalAttendance: 32,
    fb: 'Brunch. This one wants a proper brunch.',
    prize: 'Flowers for every mother, trophy for the winners.',
    tips: [
      'Run it the SATURDAY of Mother\'s Day weekend, never Sunday — Sunday belongs to families.',
      'Have a staff member shooting photos. The photos are the marketing for next year.',
    ],
  }),
  e({
    key: 'fathers-day-father-child',
    title: 'Father & Child Doubles',
    tagline: 'Dads and kids, one team',
    description:
      'The Father\'s Day counterpart. Same format, same warmth, marginally more competitive and the dads will not admit why.',
    audience: ['family', 'junior', 'men'],
    anchor: 'nearest:06-15:SAT',
    idealMonths: [6],
    formatHint: 'doubles',
    durationMinutes: 150,
    typicalFeeCents: 3000,
    typicalAttendance: 32,
    fb: 'Breakfast burritos and coffee, beer afterwards.',
    tips: ['Saturday again, not Sunday.'],
  }),
  e({
    key: 'spring-break-junior-camp',
    title: 'Spring Break Junior Camp',
    tagline: 'A week of tennis while school is out',
    description:
      'Full-week junior camp over the district spring break. Reliable revenue and the best junior-development window of the first half of the year.',
    audience: ['junior'],
    anchor: null,
    idealMonths: [3, 4],
    formatHint: null,
    durationMinutes: 360,
    courtsNeeded: 5,
    staffNeeded: 4,
    effort: 'heavy',
    typicalFeeCents: 35000,
    typicalAttendance: 30,
    tips: [
      'This date comes from the school calendar, not from you — import the district calendar before placing it.',
      'Neighbouring districts often break on different weeks. If you draw from two, check both.',
    ],
  }),
];

// ============================================================
// Family & generational
// ============================================================
const FAMILY: CatalogEntry[] = [
  e({
    key: 'parent-child-doubles',
    title: 'Parent/Child Doubles Championship',
    tagline: 'One parent, one kid, one trophy',
    description:
      'A proper flighted tournament for parent-child pairs, split by the child\'s age. Consistently the most emotionally resonant event on a club calendar — the photos run in the newsletter for years.',
    audience: ['family', 'junior'],
    anchor: null,
    idealMonths: [6, 8, 9],
    formatHint: 'rr-doubles',
    durationMinutes: 300,
    courtsNeeded: 8,
    staffNeeded: 3,
    effort: 'heavy',
    typicalFeeCents: 5000,
    typicalAttendance: 48,
    fb: 'Lunch between rounds; ice cream at the awards.',
    prize: 'Engraved trophies per age flight, plus a photo print for every pair.',
    tips: [
      'Flight by the CHILD\'S age (10U, 12U, 14U, 16U, open) — a 9-year-old and a 17-year-old are not the same event.',
      'Scoring handicap: the junior serves from inside the baseline in younger flights so rallies actually happen.',
      'Allow grandparents and guardians and say so explicitly in the invite. Not every kid has a parent who plays.',
      'Hire a photographer. This is the one event where the photos justify the cost.',
    ],
  }),
  e({
    key: 'family-olympics',
    title: 'Club Family Olympics',
    tagline: 'Tennis, swim, and silly games for points',
    description:
      'A whole-club field day. Families form teams and compete across tennis skills, pool relays, and lawn games for a single overall trophy. The best cross-department event a club can run.',
    department: 'social',
    audience: ['family', 'all'],
    anchor: null,
    idealMonths: [6, 7, 8],
    formatHint: 'team-battle',
    durationMinutes: 240,
    courtsNeeded: 6,
    staffNeeded: 6,
    effort: 'flagship',
    revenueModel: 'entry-fee-plus-fb',
    typicalFeeCents: 3000,
    typicalAttendance: 100,
    fb: 'Full cookout. Plan for the whole club.',
    prize: 'A single perpetual family trophy. One winner, whole club.',
    tips: [
      'Needs the swim and tennis staff coordinated — put one person in charge overall or it fragments.',
      'Mix families into teams rather than family-vs-family, so new members are absorbed rather than isolated.',
    ],
  }),
  e({
    key: 'grandparent-grandchild',
    title: 'Grandparent & Grandchild Day',
    tagline: 'Two generations, one court',
    description:
      'A gentle morning event pairing grandparents with grandchildren. Short court, soft balls, generous rules. Punches far above its weight for member goodwill.',
    audience: ['family', 'senior', 'junior'],
    anchor: null,
    idealMonths: [7, 8, 9],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 4,
    staffNeeded: 2,
    effort: 'easy',
    typicalFeeCents: 1500,
    typicalAttendance: 24,
    fb: 'Lemonade and cookies.',
    tips: [
      'Use red/orange balls and short court regardless of age. The point is rallies, not tennis.',
      'Schedule for late summer when grandchildren are visiting.',
    ],
  }),
  e({
    key: 'junior-parent-pro-am',
    title: 'Junior/Parent Pro-Am',
    tagline: 'Play a set with the staff',
    description:
      'Members and juniors are drawn to play alongside the teaching pros. Gives the membership a reason to meet the staff and the staff a reason to be visible.',
    audience: ['family', 'adult', 'junior'],
    anchor: null,
    idealMonths: [5, 6, 9],
    formatHint: 'doubles',
    durationMinutes: 180,
    staffNeeded: 5,
    effort: 'medium',
    typicalFeeCents: 4000,
    tips: [
      'Rotate every pro through every group. The complaint you get otherwise is "we only got the assistant".',
      'Excellent early-season event for a new head pro to meet the membership fast.',
    ],
  }),
];

// ============================================================
// Adult social formats — the connective tissue of a calendar
// ============================================================
const SOCIAL: CatalogEntry[] = [
  e({
    key: 'wine-and-nine',
    title: 'Wine & Nine',
    tagline: 'Nine games, then a tasting',
    description:
      'Nine games of doubles followed by a guided wine tasting on the deck. The event that converts social members into tennis members.',
    department: 'social',
    audience: ['adult', 'mixed'],
    anchor: null,
    idealMonths: [5, 6, 9, 10],
    formatHint: 'doubles',
    durationMinutes: 180,
    effort: 'medium',
    revenueModel: 'ticketed',
    typicalFeeCents: 5500,
    typicalAttendance: 32,
    fb: 'Four-pour tasting with a local shop, cheese and charcuterie.',
    tips: [
      'Get a local wine shop to pour for free in exchange for taking orders. Costs the club nothing.',
      'Cap it. This event is better slightly oversubscribed than half-empty.',
    ],
  }),
  e({
    key: 'beat-the-pro',
    title: 'Beat the Pro',
    tagline: 'Take a set off the staff and win your money back',
    description:
      'Members queue to play short sets against the teaching pros with a handicap. Anyone who wins gets their entry refunded or a lesson credit. Simple, cheap, and consistently packed.',
    audience: ['adult', 'junior', 'all'],
    anchor: null,
    idealMonths: [],
    formatHint: null,
    durationMinutes: 180,
    courtsNeeded: 3,
    staffNeeded: 3,
    effort: 'easy',
    typicalFeeCents: 2000,
    typicalAttendance: 30,
    prize: 'Lesson credit for anyone who wins.',
    tips: [
      'Set the handicap generously — the event dies if nobody ever wins.',
      'Great filler for a thin month; it needs almost no setup.',
    ],
  }),
  e({
    key: 'king-queen-of-court',
    title: 'King & Queen of the Court',
    tagline: 'Win and stay, lose and rotate',
    description:
      'Continuous-rotation format where winners hold the king court. Fast, loud, self-organising, and works at any attendance number.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [],
    formatHint: 'king-of-court',
    durationMinutes: 120,
    effort: 'easy',
    typicalFeeCents: 1500,
    tips: ['The best format when you do not know how many will show. Nothing breaks if it is 12 or 40.'],
  }),
  e({
    key: 'mystery-doubles-draw',
    title: 'Mystery Doubles Draw',
    tagline: 'Your partner is drawn from a hat',
    description:
      'Partners drawn at random at check-in, redrawn each round. The default social format when you want members to actually meet each other.',
    audience: ['adult', 'mixed'],
    anchor: null,
    idealMonths: [],
    formatHint: 'round-robin',
    effort: 'easy',
    typicalFeeCents: 2000,
    tips: ['Balance the hat by rating — a pure random draw produces a few unplayable mismatches every time.'],
  }),
  e({
    key: 'progressive-dinner-doubles',
    title: 'Progressive Dinner Doubles',
    tagline: 'A round of tennis between every course',
    description:
      'Play a round, eat a course, play a round, eat a course. Appetiser, main, dessert, three rounds of doubles. A genuinely memorable evening that feels far more elaborate than it is to run.',
    department: 'social',
    audience: ['adult', 'mixed'],
    anchor: null,
    idealMonths: [6, 7, 8, 9],
    formatHint: 'doubles',
    durationMinutes: 240,
    effort: 'heavy',
    revenueModel: 'ticketed',
    typicalFeeCents: 7500,
    typicalAttendance: 32,
    fb: 'Three courses, timed to the rounds. This is the event — brief the kitchen properly.',
    tips: [
      'The kitchen has to hit the round timings. Walk the schedule with them beforehand or the whole thing stalls.',
      'Shorter rounds than feel right — 20 minutes. People linger over food.',
    ],
  }),
  e({
    key: 'friday-night-lights',
    title: 'Friday Night Lights Social',
    tagline: 'The weekly one that builds the habit',
    description:
      'A recurring Friday-evening drop-in social. Not a special event — a standing fixture that gives the club a heartbeat and makes every other event easier to fill.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [5, 6, 7, 8, 9],
    formatHint: 'round-robin',
    durationMinutes: 150,
    effort: 'easy',
    typicalFeeCents: 1500,
    typicalAttendance: 24,
    fb: 'Cooler and a pizza order.',
    tips: [
      'Consistency beats programming. Same night, same time, every week, no exceptions — that is the whole trick.',
      'Needs lights for the back half of the season.',
    ],
  }),
  e({
    key: 'tacos-and-tennis',
    title: 'Tacos & Tennis',
    tagline: 'Midweek, low effort, always full',
    description:
      'A weeknight social with a taco cart. The lowest-effort, highest-satisfaction event most clubs run.',
    department: 'social',
    audience: ['adult', 'family'],
    anchor: null,
    idealMonths: [5, 6, 7, 8, 9],
    formatHint: 'round-robin',
    durationMinutes: 150,
    effort: 'easy',
    typicalFeeCents: 2500,
    fb: 'A taco cart or truck. Outsource it entirely.',
    tips: ['Book the truck first, then pick the date. Good trucks book out months ahead in summer.'],
  }),
  e({
    key: 'sunset-social-series',
    title: 'Sunset Social Series',
    tagline: 'Late-afternoon play into golden hour',
    description:
      'A recurring late-afternoon series through the hottest months, starting when the courts come back into shade. The answer to "nobody will play at 2pm in August".',
    audience: ['adult'],
    anchor: null,
    idealMonths: [7, 8],
    formatHint: 'doubles',
    durationMinutes: 150,
    effort: 'easy',
    typicalFeeCents: 1500,
    tips: ['Set the start time from actual sunset, not from a fixed clock — it moves 90 minutes across the summer.'],
  }),
];

// ============================================================
// Ladies / men's
// ============================================================
const GENDERED: CatalogEntry[] = [
  e({
    key: 'ladies-day-out',
    title: 'Ladies Day Out',
    tagline: 'Clinic, lunch, and a round robin',
    description:
      'A half-day for the women\'s membership: a themed clinic, a proper lunch, and a social round robin. The backbone of most clubs\' daytime programming.',
    audience: ['ladies'],
    anchor: null,
    idealMonths: [4, 5, 9, 10],
    formatHint: 'doubles',
    durationMinutes: 300,
    staffNeeded: 3,
    effort: 'medium',
    revenueModel: 'ticketed',
    typicalFeeCents: 6500,
    typicalAttendance: 36,
    fb: 'A real sit-down lunch. Not a sandwich platter.',
    tips: [
      'Weekday, mid-morning start. This audience is not available on Saturday.',
      'The lunch is the event. The tennis is the excuse. Budget accordingly.',
    ],
  }),
  e({
    key: 'ladies-invitational',
    title: 'Ladies Invitational',
    tagline: 'Bring a guest, play a flighted draw',
    description:
      'The women\'s member-guest. Flighted doubles across a day with a lunch and a gift bag. One of the strongest recruiting events a club has.',
    audience: ['ladies', 'member-guest'],
    anchor: null,
    idealMonths: [5, 9],
    formatHint: 'compass-doubles',
    durationMinutes: 360,
    courtsNeeded: 8,
    staffNeeded: 4,
    effort: 'flagship',
    revenueModel: 'entry-fee-plus-fb',
    typicalFeeCents: 11000,
    typicalAttendance: 48,
    fb: 'Lunch, gift bags, a dessert table.',
    prize: 'Flight prizes plus a gift for every participant.',
    tips: [
      'Flighted so every pair plays all day regardless of result.',
      'Pass the guest list to membership afterwards.',
    ],
  }),
  e({
    key: 'mens-night-out',
    title: "Men's Night Out",
    tagline: 'Doubles, steaks, and a card game',
    description:
      'An evening for the men\'s membership — competitive doubles, a grill, and whatever happens after. Reliably rowdy.',
    audience: ['men'],
    anchor: null,
    idealMonths: [5, 6, 9],
    formatHint: 'doubles',
    durationMinutes: 210,
    effort: 'medium',
    typicalFeeCents: 4500,
    typicalAttendance: 28,
    fb: 'Steaks or burgers, beer, bourbon.',
    tips: ['Needs lights. Run competitive flights — this group wants a winner.'],
  }),
  e({
    key: 'mens-member-guest',
    title: "Men's Member-Guest",
    tagline: 'Two days, a draw, and a calcutta-lite',
    description:
      'The men\'s flagship invitational. Flighted two-day draw, dinner Saturday, and often a small auction or side pot.',
    audience: ['men', 'member-guest'],
    anchor: null,
    idealMonths: [6, 9],
    formatHint: 'compass-doubles',
    durationMinutes: 600,
    courtsNeeded: 10,
    staffNeeded: 4,
    effort: 'flagship',
    revenueModel: 'entry-fee-plus-fb',
    typicalFeeCents: 14000,
    typicalAttendance: 48,
    fb: 'Friday welcome, Saturday lunch, Saturday dinner.',
    tips: [
      'If you add a side pot, read the Calcutta warning about state law and club bylaws first.',
      'Do not schedule against the ladies invitational — the same households supply both.',
    ],
  }),
];

// ============================================================
// Competitive structures & leagues
// ============================================================
const COMPETITIVE: CatalogEntry[] = [
  e({
    key: 'club-ladder-launch',
    title: 'Club Ladder Launch',
    tagline: 'A season-long challenge ladder',
    description:
      'Kick off a challenge ladder that runs all season. The launch event seeds the ladder; the ladder then generates court traffic for months with no further staffing.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [4, 5],
    formatHint: 'round-robin',
    durationMinutes: 180,
    effort: 'medium',
    typicalFeeCents: 3000,
    tips: [
      'Seed with an actual play-in event rather than self-reported ratings — self-reported ladders collapse in week two.',
      'The ladder is the highest court-traffic-per-staff-hour thing a club can run. Launch it early.',
    ],
  }),
  e({
    key: 'interclub-challenge',
    title: 'Interclub Challenge Match',
    tagline: 'Us against the club down the road',
    description:
      'A home-and-away fixture against a neighbouring club. Teams across levels, a shared lunch, and a rivalry that builds over years.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [5, 6, 9],
    formatHint: 'team-battle',
    durationMinutes: 300,
    courtsNeeded: 8,
    staffNeeded: 2,
    effort: 'medium',
    typicalFeeCents: 2500,
    typicalAttendance: 32,
    fb: 'Host club feeds both sides. Alternate each year.',
    prize: 'A perpetual trophy that physically moves between the clubs.',
    tips: [
      'Agree the format with the other director in writing. Every dispute in interclub history is about format.',
      'Alternate home and away annually and keep an all-time record. The record is what makes it matter.',
    ],
  }),
  e({
    key: 'flex-league-season',
    title: 'Flex League Season',
    tagline: 'Self-scheduled matches over 8-10 weeks',
    description:
      'A self-scheduled league where players arrange their own matches within a window. Almost no staff time, high participation, and it fills courts at off-peak hours.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [6, 7],
    formatHint: 'rr-singles',
    durationMinutes: 0,
    courtsNeeded: 0,
    staffNeeded: 1,
    effort: 'easy',
    typicalFeeCents: 4000,
    typicalAttendance: 40,
    tips: [
      'Block the whole season on the calendar as one item so it is visible, even though there is no single event date.',
      'Set a hard deadline per round and nudge the stragglers — the failure mode is always unplayed matches.',
    ],
  }),
  e({
    key: 'usta-league-home-weekend',
    title: 'USTA League Home Weekend',
    tagline: 'Courts committed to league play',
    description:
      'Not an event to programme so much as one to protect: the weekends your USTA teams are at home and the courts are not yours to give away.',
    audience: ['adult'],
    anchor: null,
    idealMonths: [4, 5, 6, 7],
    formatHint: null,
    durationMinutes: 300,
    courtsNeeded: 6,
    staffNeeded: 1,
    effort: 'easy',
    revenueModel: 'included',
    typicalFeeCents: 0,
    tips: [
      'Get the league schedule the moment it is published and put every home date on the calendar as a blocking constraint.',
      'This is the single most common cause of a double-booked Saturday.',
    ],
  }),
  e({
    key: 'jtt-season',
    title: 'Junior Team Tennis Season',
    tagline: 'Weekend match days through the season',
    description:
      'The junior team season — home match days, coaches, and a season-end tournament. Blocks a lot of weekend court time and needs to be on the calendar before anything else claims those dates.',
    audience: ['junior', 'family'],
    anchor: null,
    idealMonths: [5, 6, 7],
    formatHint: null,
    durationMinutes: 240,
    courtsNeeded: 6,
    staffNeeded: 3,
    effort: 'heavy',
    typicalFeeCents: 6000,
    typicalAttendance: 40,
    tips: [
      'Home match days block courts for most of a morning. Place these first and plan adult events around them.',
      'The season-end tournament needs its own date and often another club\'s courts.',
    ],
  }),
];

// ============================================================
// Junior programming
// ============================================================
const JUNIOR: CatalogEntry[] = [
  e({
    key: 'junior-club-championships',
    title: 'Junior Club Championships',
    tagline: 'Age-group titles and a name on the board',
    description:
      'Age-flighted junior championship across singles and doubles, finishing with a finals day and an awards ceremony parents actually attend.',
    audience: ['junior'],
    anchor: null,
    idealMonths: [8, 9],
    formatHint: 'single-elim-singles',
    durationMinutes: 360,
    courtsNeeded: 6,
    staffNeeded: 3,
    effort: 'heavy',
    typicalFeeCents: 3500,
    typicalAttendance: 48,
    fb: 'Pizza on finals day.',
    prize: 'Perpetual junior board plus medals per flight.',
    tips: [
      'Run consolation for everyone. A junior who loses first round and goes home does not come back next year.',
      'Awards ceremony with the parents present — that is the moment that sells next season.',
    ],
  }),
  e({
    key: 'junior-summer-camp-week',
    title: 'Junior Summer Camp Week',
    tagline: 'The revenue engine of the summer',
    description:
      'A week of full- or half-day junior camp. Repeated across the summer, this is typically the largest single line in a racquets department\'s budget.',
    audience: ['junior'],
    anchor: null,
    idealMonths: [6, 7, 8],
    formatHint: null,
    durationMinutes: 360,
    courtsNeeded: 6,
    staffNeeded: 5,
    effort: 'heavy',
    typicalFeeCents: 40000,
    typicalAttendance: 36,
    tips: [
      'Block every camp week on the calendar first — camp eats courts 9am-3pm and everything else has to fit around it.',
      'Check the school calendar for the actual last and first days of school; camp weeks are bounded by them.',
      'Staffing is the constraint, not courts. Plan counsellor hiring backwards from these dates.',
    ],
  }),
  e({
    key: 'red-orange-ball-festival',
    title: 'Red & Orange Ball Festival',
    tagline: '10-and-under, short court, all morning',
    description:
      'A festival-format morning for the youngest juniors — short courts, low-compression balls, rotating stations, everybody gets a medal.',
    audience: ['junior', 'family'],
    anchor: null,
    idealMonths: [5, 6, 9],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 4,
    staffNeeded: 4,
    effort: 'medium',
    typicalFeeCents: 2000,
    typicalAttendance: 32,
    fb: 'Juice and orange slices. Coffee for the parents, seriously.',
    prize: 'A medal for every single child. No exceptions.',
    tips: [
      'Stations, not matches. Attention spans are eight minutes.',
      'Invite non-member families — this is the best junior recruiting event there is.',
    ],
  }),
  e({
    key: 'junior-halloween-carnival',
    title: 'Junior Halloween Carnival',
    tagline: 'Costumes, games, candy, chaos',
    description:
      'Carnival-style junior afternoon with tennis skill games as the booths. Costumes mandatory, candy inevitable.',
    audience: ['junior', 'family'],
    anchor: 'nearest:10-31:SAT',
    idealMonths: [10],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 4,
    staffNeeded: 4,
    effort: 'medium',
    typicalFeeCents: 1500,
    typicalAttendance: 50,
    fb: 'Candy. Vast quantities of candy.',
    tips: ['Pair with the adult Halloween event on the same day to share the decorations and setup.'],
  }),
  e({
    key: 'high-school-prep-clinic',
    title: 'High School Team Prep Clinic',
    tagline: 'Sharpen up before tryouts',
    description:
      'A short intensive series timed just before high-school tryouts. Fills immediately every year because the demand is entirely deadline-driven.',
    audience: ['junior'],
    anchor: null,
    idealMonths: [2, 7, 8],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 4,
    staffNeeded: 3,
    effort: 'medium',
    typicalFeeCents: 15000,
    typicalAttendance: 20,
    tips: [
      'Timing is everything — two to three weeks before tryouts, which comes off the school calendar.',
      'Boys and girls seasons are usually different terms. That is two clinics, not one.',
    ],
  }),
  e({
    key: 'junior-awards-banquet',
    title: 'Junior Awards Banquet',
    tagline: 'End the junior year properly',
    description:
      'A season-end evening for junior players and families — awards, a slideshow, and the graduating seniors recognised.',
    department: 'social',
    audience: ['junior', 'family'],
    anchor: null,
    idealMonths: [8, 9],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 0,
    staffNeeded: 3,
    effort: 'medium',
    revenueModel: 'ticketed',
    typicalFeeCents: 3000,
    typicalAttendance: 80,
    fb: 'Buffet dinner.',
    prize: 'Awards for every age group plus senior send-offs.',
    tips: [
      'The slideshow is the whole event. Start collecting photos in June.',
      'Recognise the graduating seniors by name with their college. Parents remember this for years.',
    ],
  }),
];

// ============================================================
// Charity & community
// ============================================================
const CHARITY: CatalogEntry[] = [
  e({
    key: 'pink-ribbon-round-robin',
    title: 'Pink Ribbon Round Robin',
    tagline: 'Wear pink, play for the cause',
    description:
      'October breast-cancer-awareness round robin. Pink everything, a raffle, and proceeds to a named charity. Usually the club\'s largest single charitable total of the year.',
    department: 'social',
    audience: ['ladies', 'adult', 'all'],
    anchor: 'month:10',
    idealMonths: [10],
    formatHint: 'round-robin',
    durationMinutes: 240,
    effort: 'medium',
    revenueModel: 'fundraiser',
    typicalFeeCents: 5000,
    typicalAttendance: 56,
    fb: 'Lunch, pink desserts, a raffle table.',
    tips: [
      'Name the beneficiary specifically and publish the total afterwards. Vague charity events raise a fraction of named ones.',
      'The raffle usually out-earns the entry fees. Ask local businesses in August, not October.',
    ],
  }),
  e({
    key: 'charity-pro-am',
    title: 'Charity Pro-Am',
    tagline: 'Play with a pro, raise real money',
    description:
      'Members bid or pay a premium to play alongside teaching pros or a visiting former tour player, with proceeds to charity.',
    audience: ['adult', 'member-guest'],
    anchor: null,
    idealMonths: [5, 6, 9],
    formatHint: 'doubles',
    durationMinutes: 240,
    staffNeeded: 5,
    effort: 'heavy',
    revenueModel: 'fundraiser',
    typicalFeeCents: 15000,
    typicalAttendance: 32,
    fb: 'Reception afterwards with the pros present.',
    tips: [
      'A visiting name player transforms the take. Local college coaches and former tour players are more reachable than directors assume.',
      'Sell sponsorships per court — that is where the money actually is.',
    ],
  }),
  e({
    key: 'food-drive-round-robin',
    title: 'Food Drive Round Robin',
    tagline: 'Cans at the gate',
    description:
      'Entry is a bag of groceries for the local food bank. Costs the club nothing, fills the courts, and does obvious good.',
    department: 'social',
    audience: ['all'],
    anchor: null,
    idealMonths: [11, 12],
    formatHint: 'round-robin',
    effort: 'easy',
    revenueModel: 'fundraiser',
    typicalFeeCents: 0,
    typicalAttendance: 40,
    tips: ['Arrange the food-bank pickup before the event or the donations sit in the pro shop until February.'],
  }),
];

// ============================================================
// Pickleball & crossover
// ============================================================
const CROSSOVER: CatalogEntry[] = [
  e({
    key: 'pickleball-tennis-crossover',
    title: 'Pickleball & Tennis Crossover',
    tagline: 'Half the night on each',
    description:
      'Teams play a round of tennis and a round of pickleball, combined score decides it. Defuses the tennis-versus-pickleball tension better than any policy memo.',
    department: 'pickleball',
    audience: ['adult', 'all'],
    anchor: null,
    idealMonths: [5, 6, 9, 10],
    formatHint: 'team-battle',
    durationMinutes: 180,
    effort: 'medium',
    typicalFeeCents: 3000,
    typicalAttendance: 32,
    tips: [
      'Deliberately mix tennis regulars with pickleball regulars on the same team.',
      'The tennis players will lose at pickleball. Score it so that is survivable.',
    ],
  }),
  e({
    key: 'pickleball-social-launch',
    title: 'Pickleball Social Launch',
    tagline: 'Introduce the courts, or the programme',
    description:
      'An open, instruction-led pickleball social for members who have never played. Low barrier, high conversion.',
    department: 'pickleball',
    audience: ['adult', 'senior', 'all'],
    anchor: null,
    idealMonths: [4, 5, 9],
    formatHint: 'round-robin',
    durationMinutes: 120,
    courtsNeeded: 4,
    staffNeeded: 2,
    effort: 'easy',
    typicalFeeCents: 1500,
    typicalAttendance: 32,
    tips: ['Provide paddles. The single biggest barrier is not owning one.'],
  }),
];

// ============================================================
// Swim & whole-club (the department most calendars forget)
// ============================================================
const SWIM_SOCIAL: CatalogEntry[] = [
  e({
    key: 'pool-opening-party',
    title: 'Pool Opening Party',
    tagline: 'The day summer officially starts',
    description:
      'Opening weekend at the pool — music, a barbecue, and the whole membership through the gate on one afternoon.',
    department: 'swim',
    audience: ['family', 'all'],
    anchor: 'holiday-weekend:memorial',
    idealMonths: [5],
    formatHint: null,
    durationMinutes: 240,
    courtsNeeded: 0,
    staffNeeded: 5,
    effort: 'heavy',
    revenueModel: 'included',
    typicalFeeCents: 0,
    typicalAttendance: 150,
    fb: 'Cookout for the whole club.',
    tips: [
      'Highest-attendance day of the club year at most swim-and-tennis clubs. Staff it accordingly.',
      'Run a tennis station alongside — this is the best cross-selling opportunity the racquets department gets.',
    ],
  }),
  e({
    key: 'dive-in-movie',
    title: 'Dive-In Movie Night',
    tagline: 'A screen, a projector, and the pool',
    description:
      'A film projected poolside after dark with families floating in the water. Cheap, memorable, and requested every year once you have done it once.',
    department: 'swim',
    audience: ['family', 'junior'],
    anchor: null,
    idealMonths: [6, 7, 8],
    formatHint: null,
    durationMinutes: 150,
    courtsNeeded: 0,
    staffNeeded: 4,
    effort: 'medium',
    typicalFeeCents: 1000,
    typicalAttendance: 80,
    fb: 'Popcorn, candy, pizza.',
    tips: [
      'You need a public-performance licence for the film. Genuinely — clubs get letters about this.',
      'Lifeguards on duty for the whole screening. Dark water is the risk.',
      'Start time follows sunset, so it drifts an hour across the summer.',
    ],
  }),
  e({
    key: 'swim-tennis-combo-meet',
    title: 'Swim & Tennis Combo Day',
    tagline: 'Both departments, one scoreboard',
    description:
      'A joint day where families score points in both the pool and on the courts toward a single club total. The event that makes a swim-and-tennis club feel like one club.',
    department: 'swim',
    audience: ['family', 'junior', 'all'],
    anchor: null,
    idealMonths: [6, 7],
    formatHint: 'team-battle',
    durationMinutes: 300,
    courtsNeeded: 6,
    staffNeeded: 8,
    effort: 'flagship',
    typicalFeeCents: 2500,
    typicalAttendance: 120,
    fb: 'Cookout between sessions.',
    tips: [
      'Needs both department heads bought in from the planning stage, not informed afterwards.',
      'Stagger so families can do both — swim in the morning, tennis in the afternoon.',
    ],
  }),
  e({
    key: 'end-of-summer-carnival',
    title: 'End of Summer Carnival',
    tagline: 'The whole club, one last time',
    description:
      'A carnival-format send-off for the summer — games, food, tennis and swim stations, prizes. The largest social event of the year at most family clubs.',
    department: 'social',
    audience: ['family', 'all'],
    anchor: null,
    idealMonths: [8],
    formatHint: null,
    durationMinutes: 300,
    courtsNeeded: 6,
    staffNeeded: 10,
    effort: 'flagship',
    revenueModel: 'entry-fee-plus-fb',
    typicalFeeCents: 2500,
    typicalAttendance: 200,
    fb: 'Full carnival food — the works.',
    tips: [
      'Schedule before school starts, not after. Once school is back this event loses half its attendance.',
      'Needs volunteers, not just staff. Recruit in June.',
    ],
  }),
  e({
    key: 'polar-plunge',
    title: 'New Year Polar Plunge',
    tagline: 'Into the cold water, for charity',
    description:
      'A January 1st plunge with pledges to a charity. Twenty minutes of activity and a year of photographs.',
    department: 'swim',
    audience: ['all', 'family'],
    anchor: 'holiday:new-years-day',
    idealMonths: [1],
    formatHint: null,
    durationMinutes: 90,
    courtsNeeded: 0,
    staffNeeded: 3,
    effort: 'easy',
    revenueModel: 'fundraiser',
    typicalFeeCents: 2500,
    typicalAttendance: 40,
    outdoor: true,
    fb: 'Hot chocolate and towels. Lots of towels.',
    tips: ['Lifeguards and a warm-up area are not optional. Cold-water shock is real.'],
  }),
  e({
    key: 'new-member-reception',
    title: 'New Member Welcome Reception',
    tagline: 'Introduce them before they drift',
    description:
      'A short reception for members who joined in the last year, with department heads present and a court and pool tour. The cheapest retention spend a club can make.',
    department: 'social',
    audience: ['adult', 'family'],
    anchor: null,
    idealMonths: [4, 9],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 2,
    staffNeeded: 4,
    effort: 'easy',
    revenueModel: 'included',
    typicalFeeCents: 0,
    typicalAttendance: 40,
    fb: 'Drinks and appetisers.',
    tips: [
      'Run it twice a year. New members who have not met anyone by month three are the ones who leave.',
      'Pair each new family with an existing member as a host. It works far better than name badges.',
    ],
  }),
  e({
    key: 'volunteer-appreciation',
    title: 'Volunteer & Staff Appreciation Night',
    tagline: 'Thank the people who ran the year',
    description:
      'An end-of-season thank-you for the captains, committee members, coaches, and volunteers the calendar quietly depends on.',
    department: 'social',
    audience: ['adult'],
    anchor: null,
    idealMonths: [10, 11],
    formatHint: null,
    durationMinutes: 120,
    courtsNeeded: 0,
    staffNeeded: 2,
    effort: 'easy',
    revenueModel: 'included',
    typicalFeeCents: 0,
    typicalAttendance: 40,
    fb: 'Dinner, on the club.',
    tips: ['Put it on the calendar in January. It is the first thing dropped when the year gets busy, and the one that costs most to skip.'],
  }),
  e({
    key: 'trivia-night',
    title: 'Club Trivia Night',
    tagline: 'No racquets required',
    description:
      'An off-season social with no athletic component at all, which is exactly why it reaches the members the racquets calendar never touches.',
    department: 'social',
    audience: ['adult', 'all'],
    anchor: null,
    idealMonths: [1, 2, 11],
    formatHint: null,
    durationMinutes: 150,
    courtsNeeded: 0,
    staffNeeded: 2,
    effort: 'easy',
    revenueModel: 'ticketed',
    typicalFeeCents: 2500,
    typicalAttendance: 60,
    outdoor: false,
    fb: 'Bar service and a snack table.',
    tips: [
      'Include a club-history round. It is always the most popular.',
      'Weather-proof and indoor — the reliable answer to a dead January.',
    ],
  }),
];

/** The full seeded catalog. */
export const CATALOG: CatalogEntry[] = [
  ...SLAMS,
  ...SUMMER,
  ...FALL,
  ...WINTER,
  ...SPRING,
  ...FAMILY,
  ...SOCIAL,
  ...GENDERED,
  ...COMPETITIVE,
  ...JUNIOR,
  ...CHARITY,
  ...CROSSOVER,
  ...SWIM_SOCIAL,
];

const BY_KEY = new Map(CATALOG.map((c) => [c.key, c]));

export function catalogEntry(key: string | null | undefined): CatalogEntry | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export interface CatalogFilter {
  department?: Department;
  audience?: Audience;
  /** 1-12. Matches entries with no month preference too. */
  month?: number;
  effort?: Effort;
  /** Free-text over title, tagline, and description. */
  q?: string;
}

export function filterCatalog(f: CatalogFilter = {}): CatalogEntry[] {
  const q = f.q?.trim().toLowerCase();
  return CATALOG.filter((c) => {
    if (f.department && c.department !== f.department) return false;
    if (f.audience && !c.audience.includes(f.audience) && !c.audience.includes('all')) return false;
    if (f.effort && c.effort !== f.effort) return false;
    if (f.month && c.idealMonths.length > 0 && !c.idealMonths.includes(f.month)) return false;
    if (q) {
      const hay = `${c.title} ${c.tagline} ${c.description} ${c.key}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Catalog keys grouped for the ideas browser. */
export const CATALOG_GROUPS: Array<{ label: string; keys: string[] }> = [
  { label: 'Grand Slam series', keys: SLAMS.map((c) => c.key) },
  { label: 'Summer & patriotic', keys: SUMMER.map((c) => c.key) },
  { label: 'Fall & flagship', keys: FALL.map((c) => c.key) },
  { label: 'Winter & holidays', keys: WINTER.map((c) => c.key) },
  { label: 'Spring', keys: SPRING.map((c) => c.key) },
  { label: 'Family & generational', keys: FAMILY.map((c) => c.key) },
  { label: 'Adult socials', keys: SOCIAL.map((c) => c.key) },
  { label: "Ladies & men's", keys: GENDERED.map((c) => c.key) },
  { label: 'Leagues & competition', keys: COMPETITIVE.map((c) => c.key) },
  { label: 'Junior programming', keys: JUNIOR.map((c) => c.key) },
  { label: 'Charity & community', keys: CHARITY.map((c) => c.key) },
  { label: 'Pickleball & crossover', keys: CROSSOVER.map((c) => c.key) },
  { label: 'Swim, social & whole-club', keys: SWIM_SOCIAL.map((c) => c.key) },
];

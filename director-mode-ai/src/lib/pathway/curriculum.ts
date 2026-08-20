/**
 * The ClubMode Junior Pathway curriculum.
 *
 * Five ball colors, five STRINGS per color (a kid earns their strings — they are
 * tennis players), three pass/fail tests per string.
 * The 5th string of each color IS the promotion test — clear it and the kid
 * moves up, announced in front of everybody. High Performance sits at the top
 * as an invitation tier: Yellow 5 is how a kid earns the invite.
 *
 * This is deliberately a config file, not a database table: the curriculum is
 * versioned product content, identical in shape for every club on ClubMode.
 * Player positions live in the DB (pathway_players / pathway_awards) and
 * reference stripes by key, e.g. "yellow-3".
 *
 * House rules (rendered on every family page):
 *   - Test Day is the LAST class of every month; parents stay for the last 15.
 *   - A kid must attend 3 of the month's 4 classes to test.
 *   - A kid must be registered for the next month to test.
 *   - Not everyone passes. Retest next month.
 */

export type StripeTest = string;

export type Stripe = {
  key: string;            // "red-1" … "yellow-5"
  number: 1 | 2 | 3 | 4 | 5;
  title: string;
  tests: [StripeTest, StripeTest, StripeTest];
  promotes: boolean;      // true only on stripe 5
};

export type LevelKey = 'red' | 'orange' | 'green' | 'yellow' | 'hp';

export type Level = {
  key: LevelKey;
  name: string;
  tagline: string;        // one line under the level name on the family page
  court: string;
  ball: string;
  /** Display colors — chosen to read on both the dark app and light family page. */
  color: string;          // the ball color
  colorDark: string;      // a deeper shade for text-on-light
  order: number;          // 0 at the bottom of the climb
  invitational: boolean;
  stripes: Stripe[];
};

const s = (
  level: LevelKey,
  number: 1 | 2 | 3 | 4 | 5,
  title: string,
  tests: [string, string, string],
): Stripe => ({ key: `${level}-${number}`, number, title, tests, promotes: number === 5 });

export const LEVELS: Level[] = [
  {
    key: 'red',
    name: 'Red Ball',
    tagline: 'Where every player starts. 36-foot court, red ball.',
    court: "36' court",
    ball: 'Red ball',
    color: '#ef4444',
    colorDark: '#b91c1c',
    order: 0,
    invitational: false,
    stripes: [
      s('red', 1, 'Racquet Control', [
        '10 consecutive taps up on the strings, and 10 dribbles down',
        'Hold ready position and split step on command, 5 times in a row',
        'Net to baseline and back without dropping the racquet',
      ]),
      s('red', 2, 'Contact', [
        '5 of 8 hand-fed forehands land in the red court',
        '5 of 8 hand-fed backhands land in the red court (two hands is fine)',
        'Finish every swing low-to-high, racquet up by the shoulder',
      ]),
      s('red', 3, 'Rally', [
        '6-ball cooperative rally with a coach over the net',
        'Track the ball and let one bounce happen without swinging early',
        'Say which side is forehand and which is backhand without being told',
      ]),
      s('red', 4, 'Serve & Score', [
        '3 of 5 underhand serves into the correct box',
        'Say the score in order — 0, 15, 30, 40, game',
        'Call your own ball in or out and mean it',
      ]),
      s('red', 5, 'Play', [
        'Play 3 full points start to finish, serving, no reset',
        'Win one tiebreak to 7 against another kid',
        'Shake hands and say the score at the end',
      ]),
    ],
  },
  {
    key: 'orange',
    name: 'Orange Ball',
    tagline: 'The court grows to 60 feet. So does the game.',
    court: "60' court",
    ball: 'Orange ball',
    color: '#f97316',
    colorDark: '#c2410c',
    order: 1,
    invitational: false,
    stripes: [
      s('orange', 1, 'Footwork', [
        'Split step on every single ball for a 10-ball feed',
        'Recover to the middle after 5 consecutive shots without being reminded',
        'Side-shuffle the ladder without crossing the feet',
      ]),
      s('orange', 2, 'Groundstroke Shape', [
        '8 of 10 forehands land past the service line, full finish over the shoulder',
        '6 of 10 backhands the same',
        'Show a unit turn before the ball bounces',
      ]),
      s('orange', 3, 'Rally', [
        "10-ball rally with a coach on the 60' court, no feed reset",
        '6 balls in a row on the backhand wing alone',
        'Keep the rally alive after being pulled wide once',
      ]),
      s('orange', 4, 'Serve', [
        'Overhand motion — trophy position, then drive up to the ball',
        '4 of 8 serves into the correct box from the orange baseline',
        'A second serve that goes in when the first one misses',
      ]),
      s('orange', 5, 'Compete', [
        'Play a full match to 4 games, serving, keeping your own score',
        'Win 2 of 3 points at the net after an approach shot',
        'Play the whole match without a coach running it',
      ]),
    ],
  },
  {
    key: 'green',
    name: 'Green Ball',
    tagline: 'Full court for the first time. Green-dot ball.',
    court: "78' full court",
    ball: 'Green-dot ball',
    color: '#22c55e',
    colorDark: '#15803d',
    order: 2,
    invitational: false,
    stripes: [
      s('green', 1, 'Consistency', [
        '15-ball cross-court rally with a partner, full court',
        '10 of those on the backhand side',
        'No ball into the net on the second bounce for the whole drill',
      ]),
      s('green', 2, 'Direction', [
        '7 of 10 balls into a target zone cross-court',
        'Change direction down the line on call, 5 of 10',
        '3 in a row deep past the service line on demand',
      ]),
      s('green', 3, 'Serve & Return', [
        '5 of 10 first serves in with a full motion from the full-court baseline',
        '6 of 10 returns land past the service line',
        'Second serve in play 8 of 10 times',
      ]),
      s('green', 4, 'Net Game', [
        '10 consecutive volleys — 5 forehand, 5 backhand — from the service line',
        'Put away 3 of 5 overheads',
        'Approach, split, volley — the whole sequence, 4 of 6',
      ]),
      s('green', 5, 'Match Play', [
        'Win a set to 4 against a peer, serving, self-scored, no coach',
        'Play one full club or Junior Team Tennis match',
        'Call every line honestly for a whole set',
      ]),
    ],
  },
  {
    key: 'yellow',
    name: 'Yellow Ball',
    tagline: 'The real thing. Full court, yellow ball, real matches.',
    court: 'Full court',
    ball: 'Yellow ball',
    color: '#eab308',
    colorDark: '#a16207',
    order: 3,
    invitational: false,
    stripes: [
      s('yellow', 1, 'Rally Under Pressure', [
        '20-ball cross-court rally with a partner, no errors',
        '10-ball down-the-line rally',
        'Hold the rally after being pulled off the court twice',
      ]),
      s('yellow', 2, 'Serve', [
        '6 of 10 first serves in with real pace',
        '8 of 10 second serves in with spin — kick or slice, your choice',
        'Serve to the corner that is called, 4 of 6',
      ]),
      s('yellow', 3, 'Patterns', [
        'Serve +1: serve wide, first ball to the open court, 4 of 6',
        'Run a 3-shot pattern the coach names, twice',
        'Say out loud what you are trying to do before the point starts',
      ]),
      s('yellow', 4, 'Defense & Transition', [
        'Slice or lob to reset from behind the baseline, 4 of 6',
        'Approach-and-volley combination won 4 of 6',
        'Get back to neutral after being pushed into the back fence',
      ]),
      s('yellow', 5, 'Competition', [
        'Play a complete set with a tiebreak, fully self-officiated',
        'Play a USTA match or a club tournament',
        'Have a UTR',
      ]),
    ],
  },
  {
    key: 'hp',
    name: 'High Performance',
    tagline: 'Invitation only. Yellow 5 is how you earn the invite.',
    court: 'Full court',
    ball: 'Yellow ball',
    color: '#a78bfa',
    colorDark: '#6d28d9',
    order: 4,
    invitational: true,
    stripes: [],
  },
];

export const LEVEL_BY_KEY: Record<LevelKey, Level> = Object.fromEntries(
  LEVELS.map((l) => [l.key, l]),
) as Record<LevelKey, Level>;

export const STRIPE_BY_KEY: Record<string, Stripe> = Object.fromEntries(
  LEVELS.flatMap((l) => l.stripes.map((st) => [st.key, st])),
);

export const LEVEL_KEYS = LEVELS.map((l) => l.key);

export function nextLevel(key: LevelKey): Level | null {
  const lvl = LEVEL_BY_KEY[key];
  return LEVELS.find((l) => l.order === lvl.order + 1) ?? null;
}

/** Stripes a player holds inside one level, from their award stripe keys. */
export function stripesInLevel(level: LevelKey, awardKeys: string[]): number {
  return awardKeys.filter((k) => k.startsWith(`${level}-`)).length;
}

export const HOUSE_RULES = [
  'Test Day is the last class of every month — parents are invited to stay for the final 15 minutes.',
  "To test, a player must have attended 3 of the month's 4 classes.",
  'To test, a player must be registered for the next month.',
  'Not everyone passes — and that is the point. Retest next month.',
];

/** What clears Yellow 5 / tops the ladder earns at Sleepy Hollow. */
export const SUMMIT_REWARDS = [
  'A club hoodie with your rank on the sleeve',
  'Your name on the board in the pro shop',
  'A match against the Director of Tennis',
];

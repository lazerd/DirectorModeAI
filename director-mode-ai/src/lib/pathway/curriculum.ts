/**
 * The ClubMode Junior Pathway curriculum.
 *
 * Five ball colors, five STRINGS per color (a kid earns their strings — they
 * are tennis players), three pass/fail tests per string. The 5th string of
 * each color IS the promotion test — clear it and the kid moves up, announced
 * in front of everybody. High Performance sits at the top as an invitation
 * tier: Yellow 5 is how a kid earns the invite.
 *
 * Every test carries three layers so the site is the one-stop shop:
 *   label — the one-line standard (shown everywhere, printed on packets)
 *   what  — what the test actually measures
 *   how   — how the coach administers it on Test Day
 *   pass  — the exact bar, and what a miss means
 *
 * This is deliberately a config file, not a database table: the curriculum is
 * versioned product content, identical in shape for every club on ClubMode.
 * Player positions live in the DB (pathway_players / pathway_awards /
 * pathway_test_checks) and reference strings by key, e.g. "yellow-3".
 */

export type StripeTest = {
  label: string;
  what: string;
  how: string;
  pass: string;
};

export type Stripe = {
  key: string;            // "red-1" … "yellow-5"
  number: 1 | 2 | 3 | 4 | 5;
  title: string;
  tests: [StripeTest, StripeTest, StripeTest];
  promotes: boolean;      // true only on string 5
};

export type LevelKey = 'red' | 'orange' | 'green' | 'yellow' | 'hp';

export type Level = {
  key: LevelKey;
  name: string;
  tagline: string;
  court: string;
  ball: string;
  color: string;
  colorDark: string;
  order: number;
  invitational: boolean;
  stripes: Stripe[];
};

const s = (
  level: LevelKey,
  number: 1 | 2 | 3 | 4 | 5,
  title: string,
  tests: [StripeTest, StripeTest, StripeTest],
): Stripe => ({ key: `${level}-${number}`, number, title, tests, promotes: number === 5 });

const t = (label: string, what: string, how: string, pass: string): StripeTest =>
  ({ label, what, how, pass });

export const LEVELS: Level[] = [
  {
    key: 'red',
    name: 'Red Ball',
    tagline: 'Where every player starts. Tests here are about effort and habits — nobody has to win anything yet.',
    court: "36' court",
    ball: 'Red ball',
    color: '#ef4444',
    colorDark: '#b91c1c',
    order: 0,
    invitational: false,
    stripes: [
      s('red', 1, 'Racquet Control', [
        t('10 consecutive taps up on the strings, and 10 dribbles down',
          'Hand-eye coordination and soft hands — can the player control the ball on the strings without chasing it.',
          'Player stands still with their own racquet and one red ball. Coach counts out loud. Taps up first, then dribbles down to the ground. One restart is allowed per direction.',
          '10 in a row up AND 10 in a row down, feet roughly planted. Walking three steps to chase the ball is a miss — reset and try again.'),
        t('Hold ready position and split step on command, 5 times in a row',
          'The athletic base every shot starts from — knees bent, racquet up, weight on the balls of the feet.',
          "Coach faces the player and calls 'SPLIT!' five times at uneven intervals while the player holds ready position. Watch the feet: both should leave the ground a little and land wide.",
          'All 5 splits land on time, wide, and balanced. Flat-footed or late twice is a retest.'),
        t('Net to baseline and back without dropping the racquet',
          'Moving with the racquet as part of the body — balance while running.',
          'Player starts at the net holding the racquet in ready carry, runs to the baseline, touches it with the racquet head, and returns. Nothing is timed — this is about control, not speed.',
          'Complete the round trip with the racquet under control the whole way. A dropped racquet is a simple do-over — up to two tries.'),
      ]),
      s('red', 2, 'Contact', [
        t('5 of 8 hand-fed forehands land in the red court',
          'Clean contact out front on the forehand side with a low-to-high swing.',
          "Coach kneels near the net post and hand-feeds 8 gentle bounces to the player's forehand from about 10 feet. Player hits into the 36-foot court.",
          '5 of the 8 land in. Contact must be a swing, not a push — a caught-and-shoveled motion does not count even if it lands in.'),
        t('5 of 8 hand-fed backhands land in the red court (two hands is fine)',
          'Same clean contact on the backhand side. Two hands are encouraged at this age.',
          'Identical setup to the forehand test: 8 hand feeds to the backhand side, coach kneeling at the net post.',
          '5 of 8 in the court. Watch for the player sneaking around to hit a forehand — a run-around is a miss for that feed.'),
        t('Finish every swing low-to-high, racquet up by the shoulder',
          'Swing shape — the habit that makes topspin possible later.',
          'Judged across the 16 feeds of the two tests above, not as a separate drill. Coach watches the finish position on every swing.',
          'The finish ends up by the opposite shoulder on clearly most swings. Chopping down or stopping at the hip on half the feeds is a retest.'),
      ]),
      s('red', 3, 'Rally', [
        t('6-ball cooperative rally with a coach over the net',
          'Keeping a real rally alive — tracking, moving, recovering, and returning the ball to a person.',
          'Coach stands on the other side of the 36-foot net and rallies WITH the player, keeping feeds easy. Count out loud. Coach errors do not reset the count.',
          "6 player-hits in a row without the player missing. Three attempts allowed — it's a rally test, not a pressure test."),
        t('Track the ball and let one bounce happen without swinging early',
          'Patience and reading the bounce — the number one habit gap at this age.',
          'During the rally test (or 6 extra feeds), coach watches timing: does the player wait for the bounce and hit at the top, or lunge at the ball in the air?',
          'Waits for one bounce and swings on time on at least 5 of 6 balls. Swinging before the bounce twice is a retest.'),
        t('Say which side is forehand and which is backhand without being told',
          'Vocabulary and self-awareness — the player owns their two sides.',
          "Coach holds a ball to one side, then the other, and asks 'what shot is this?' Four times in mixed order.",
          '4 of 4 named correctly. Hesitation is fine; guessing is not.'),
      ]),
      s('red', 4, 'Serve & Score', [
        t('3 of 5 underhand serves into the correct box',
          'Starting a point legally by themselves — the first step of independence.',
          'Player serves underhand from the 36-foot baseline, alternating deuce and ad sides. Coach calls which box before each serve.',
          '3 of 5 land in the box that was called. A serve into the wrong box is a miss even if it lands in.'),
        t('Say the score in order — 0, 15, 30, 40, game',
          'Scoring literacy — a player who can keep score can play without an adult.',
          "Coach asks the player to recite the scoring ladder, then plays two quick pretend points and asks what the score is now.",
          'Recites the ladder correctly and updates the score correctly after both pretend points.'),
        t('Call your own ball in or out — and mean it',
          'Honest, confident line-calling — the foundation of self-officiated tennis.',
          'During point play, coach deliberately lands two balls near lines and asks the player to make the call out loud with a hand signal.',
          "Makes a clear, immediate, honest call both times. 'I don't know' gets one coaching moment, then a retest ball."),
      ]),
      s('red', 5, 'Play', [
        t('Play 3 points start to finish, each starting with an underhand serve',
          'Putting the pieces together: start a point, keep it going, let it end. Nobody has to win anything.',
          'Player plays 3 points with the coach as the other player. The coach keeps every ball easy and rescues the rally when needed — the player just has to start each point legally and play it out.',
          'All 3 points start with an underhand serve attempt and get played to a finish. Winning is NOT required at Red Ball — completing real points is.'),
        t('Play a first-to-5 mini game against a friend — and finish it, win or lose',
          'Being in a game with a scoreboard for the first time — staying engaged from the first point to the last.',
          'Two players play first-to-5 points. Coach stands with them, feeds the ball in when serves break down, and helps count the score out loud.',
          'The game reaches 5 with the player trying on every point. Win or lose does not matter one bit — quitting, wandering off, or melting down is the only way to miss.'),
        t('Shake hands and say who won at the end',
          'Sportsmanship as a habit — every game ends at the net with a handshake.',
          'Observed at the end of the mini game: does the player come to the net, shake hands, and say who won without being told?',
          'Does it unprompted, happily, win or lose. Being reminded once means a retest at the next game.'),
      ]),
    ],
  },
  {
    key: 'orange',
    name: 'Orange Ball',
    tagline: 'The court grows to 60 feet. Tests stay friendly — real skills, coach right there.',
    court: "60' court",
    ball: 'Orange ball',
    color: '#f97316',
    colorDark: '#c2410c',
    order: 1,
    invitational: false,
    stripes: [
      s('orange', 1, 'Footwork', [
        t('Split step on every single ball for a 10-ball feed',
          'The split step as an automatic habit, not a coached reminder.',
          'Coach feeds 10 balls at rally pace, alternating sides, and watches only the feet.',
          "10 of 10 balls have a visible split step timed to the coach's contact. Nine is a retest — this one is binary on purpose."),
        t('Recover to the middle after 5 consecutive shots without being reminded',
          'Court coverage — hit, recover, ready. No admiring the shot.',
          'A 5-ball side-to-side feed. After each hit the player must cross the center hash before the next feed comes.',
          'All 5 recoveries happen unprompted. One verbal reminder from the coach fails the attempt; run it again.'),
        t('Side-shuffle the ladder without crossing the feet',
          'Lateral movement mechanics that protect balance on wide balls.',
          'Two passes through an agility ladder (or a line of 8 spots), shuffling sideways, racquet held in ready carry.',
          'Both passes clean: feet never cross, hips stay low, head stays level.'),
      ]),
      s('orange', 2, 'Groundstroke Shape', [
        t('6 of 10 forehands land past the service line, full finish over the shoulder',
          'Depth with real swing shape — hitting THROUGH the ball, not bunting it in.',
          'Coach feeds 10 medium-pace balls to the forehand from the opposite baseline. Cones mark the service line.',
          '6 of 10 land beyond the service line AND carry a full over-the-shoulder finish. A deep ball with a chopped finish is a miss.'),
        t('5 of 10 backhands the same',
          'The same depth-and-shape standard on the weaker wing.',
          'Identical to the forehand test: 10 feeds to the backhand, same target.',
          '5 of 10 deep with a full finish. Two-handed is expected at this level.'),
        t('Show a unit turn before the ball bounces',
          "Early preparation — shoulders and racquet turn together as the ball leaves the other side.",
          'Judged during the 20 feeds above: at each bounce, had the player already turned?',
          'Turned before the bounce on roughly 8 of 10 balls. Late prep on half the feeds is a retest.'),
      ]),
      s('orange', 3, 'Rally', [
        t("10-ball rally with a coach on the 60' court, no feed reset",
          'Sustained rally tolerance at real distance — consistency under continuous play.',
          'Coach rallies cooperatively from the opposite baseline, counting player hits out loud. If the coach misses, the count stands and the rally restarts at the same number.',
          '10 player-hits in one unbroken run (coach errors excluded). Three attempts.'),
        t('6 balls in a row on the backhand wing alone',
          'Backhand reliability — no hiding the weak side.',
          'Cooperative rally where the coach plays every ball to the backhand half. Player must answer with backhands.',
          '6 consecutive backhands in play. A run-around forehand resets the count.'),
        t('Keep the rally alive after being pulled wide once',
          'Recovering from defense — the rally does not end because the player had to run.',
          'Mid-rally, coach deliberately pulls the player wide once, then continues the rally. Run it three times.',
          'On at least 2 of 3, the wide ball comes back in play AND the player recovers to continue the rally at least two more shots.'),
      ]),
      s('orange', 4, 'Serve', [
        t('Overhand motion — trophy position, then drive up to the ball',
          'A real serve motion: rhythm, trophy, upward swing. The pattern, not yet the outcome.',
          'Player hits 6 serves while the coach watches only the motion: down-together-up-together, a held trophy shape, contact above the head.',
          'A clear trophy position and upward drive on at least 5 of 6 swings, regardless of where the ball lands.'),
        t('4 of 8 serves into the correct box from the orange baseline',
          'Turning the motion into a playable serve.',
          '8 overhand serves from the 60-foot baseline, alternating boxes, coach calling the target box each time.',
          '4 of 8 in the called box. Underhand does not count at this level.'),
        t('A second serve that goes in when the first one misses',
          'The idea of a second serve — reliability on demand, no double-fault spiral.',
          "Coach announces 'second serve' before each ball. Player hits 5 of them; any safe motion is allowed — slower swing, higher net clearance.",
          '3 of 5 second serves land in. The point is a repeatable safe serve, not pace.'),
      ]),
      s('orange', 5, 'Compete', [
        t('Play a first-to-7 mini match against a friend, calling the score out loud',
          'A real match with a real scoreboard, sized for a 5-6 year old — points, not games and sets.',
          'Two players play first-to-7 points, alternating serves every 2 points. The coach stands courtside, helps untangle score disputes, but does not play.',
          'The match reaches 7 with the player announcing the score before most points. Winning is not required — running a real scoreboard is.'),
        t('Win 2 of 3 points at the net after an approach shot',
          'Willingness to move forward and finish — the beginning of an all-court game.',
          'Coach feeds a short ball; player approaches, then plays out the point against the coach, who hits soft, catchable passes right at the player. Run 3 points.',
          'Win 2 of the 3 net points. The coach is feeding wins here — staying on the baseline after the short ball is the only real way to miss.'),
        t('Handle the between-point jobs yourself: balls, sides, score',
          'The first taste of independence — the player runs the housekeeping, the coach runs nothing.',
          'Observed during the mini match above: does the player collect balls, go to the right side, and announce the score without being steered?',
          'At most one reminder across the whole match. Two or more means a retest next month — this one comes fast with a month of practice.'),
      ]),
    ],
  },
  {
    key: 'green',
    name: 'Green Ball',
    tagline: 'Full court for the first time — and the first tests you have to win.',
    court: "78' full court",
    ball: 'Green-dot ball',
    color: '#22c55e',
    colorDark: '#15803d',
    order: 2,
    invitational: false,
    stripes: [
      s('green', 1, 'Consistency', [
        t('15-ball cross-court rally with a partner, full court',
          'Full-court consistency with a peer, not a coach — real rally tolerance.',
          "Two players rally cross-court on the full court. Coach counts the tested player's hits out loud.",
          '15 hits by the tested player in one run. Coach may substitute as partner if the peer cannot sustain it. Three attempts.'),
        t('10 of those on the backhand side',
          'The same standard on the backhand diagonal.',
          'Same setup, backhand cross-court only.',
          '10 backhands in play in one run. Run-arounds reset the count.'),
        t('No ball into the net on the second bounce for the whole drill',
          'Net-clearance discipline — misses while learning should be long, never dumped into the net.',
          'Judged across both rally tests above. Coach tracks every player error: net, or past the lines?',
          'Zero net errors across one complete successful run of each rally. Net errors during failed runs are fine — the standard applies to the passing runs.'),
      ]),
      s('green', 2, 'Direction', [
        t('7 of 10 balls into a target zone cross-court',
          'Aiming under rally conditions — control of the racquet face and contact point.',
          'Coach marks a cross-court target zone (service box plus six feet) with cones and feeds 10 rally-pace balls.',
          '7 of 10 into the zone. Balls in play but outside the zone are misses.'),
        t('Change direction down the line on call, 5 of 10',
          'Redirecting the ball — the hardest directional skill in tennis.',
          "Cross-court rally feed; when the coach calls 'LINE!', the player redirects that ball down the line. Called 10 times total.",
          '5 of 10 called balls land in the down-the-line half. Redirecting without the call means the player is not listening — those do not count.'),
        t('3 in a row deep past the service line on demand',
          'Depth on command — the pressure version of the depth standard.',
          "Coach announces 'depth test now' mid-feed and counts the next balls.",
          '3 consecutive balls past the service line, within the first two times it is called.'),
      ]),
      s('green', 3, 'Serve & Return', [
        t('5 of 10 first serves in with a full motion from the full-court baseline',
          'A real serve at full distance.',
          '10 first serves, alternating boxes, full overhand motion required.',
          '5 of 10 in. The motion must include a trophy and full extension — pushed serves do not count.'),
        t('6 of 10 returns land past the service line',
          'The return as a weapon in training: deep and in play, every time.',
          'Coach (or a strong peer) hits 10 medium-pace serves; player returns from a proper return position.',
          '6 of 10 returns in play AND past the service line.'),
        t('Second serve in play 8 of 10 times',
          'The no-double-fault standard.',
          "10 second serves, alternating boxes, each one announced as 'second serve' to add weight.",
          '8 of 10 in the correct box. This is the most important serving stat in junior tennis — the bar is high on purpose.'),
      ]),
      s('green', 4, 'Net Game', [
        t('10 consecutive volleys — 5 forehand, 5 backhand — from the service line',
          "Volley technique: block, don't swing; move through the ball.",
          'Coach feeds from the opposite baseline, alternating sides; player volleys from the service line.',
          '10 in a row in play, 5 each side. A full-backswing volley gets one warning, then counts as a miss even if it lands in.'),
        t('Put away 3 of 5 overheads',
          'Finishing the lob — feet back first, then up to the ball.',
          'Coach throws or hits 5 medium lobs from the net; player starts at the service line.',
          "3 of 5 overheads land in with authority — bouncing over the coach's head or clearly unreturnable."),
        t('Approach, split, volley — the whole sequence, 4 of 6',
          'Linking the transition: approach off a short ball, split at the service line, first volley in.',
          'Coach feeds a short ball; player approaches down the line, splits as the coach hits a pass, and volleys. Run 6 sequences.',
          '4 of 6 sequences end with the first volley in play. Missing the split step fails the sequence even if the volley lands.'),
      ]),
      s('green', 5, 'Match Play', [
        t('Win a set to 4 against a peer, serving, self-scored, no coach',
          'A complete competitive set — the promotion standard.',
          'First to 4 games (no-ad is fine) against a peer within one string of the player. Fully self-officiated.',
          'Win one such set. Attempts can run in class all month and bank when won.'),
        t('Play one full club or Junior Team Tennis match',
          'Real competition outside the lesson bubble.',
          'Any club ladder match, JTT match, or in-house tournament match, verified by the coach or director.',
          'Complete the match. The result is irrelevant.'),
        t('Call every line honestly for a whole set',
          'Officiating integrity across a full set — calls, score, lets, all of it.',
          'Observed during the set-to-4 above. Coach silently tracks every close call.',
          'No hooked calls, no forgotten scores; disputes settled by replaying the point. One bad-faith call fails the test — honesty is the whole point.'),
      ]),
    ],
  },
  {
    key: 'yellow',
    name: 'Yellow Ball',
    tagline: 'The real thing. Full court, yellow ball, real matches, real standards.',
    court: 'Full court',
    ball: 'Yellow ball',
    color: '#eab308',
    colorDark: '#a16207',
    order: 3,
    invitational: false,
    stripes: [
      s('yellow', 1, 'Rally Under Pressure', [
        t('20-ball cross-court rally with a partner, no errors',
          'Grown-up consistency: twenty balls of patient, purposeful cross-court hitting with the yellow ball.',
          "Two players rally cross-court at genuine rally pace — not moonballs, not blasting. Coach counts the tested player's hits.",
          '20 hits in one unbroken run. The coach can stand in as partner if peers cannot hold up their end. Three attempts.'),
        t('10-ball down-the-line rally',
          'The harder diagonal: lower net, shorter court, less margin.',
          'Both players rally down the line on one half of the court.',
          '10 player-hits in one run down the line.'),
        t('Hold the rally after being pulled off the court twice',
          'Defense into neutral: two stretch balls in one rally and the point is still alive.',
          'Coach rallies, deliberately pulling the player wide twice within one rally, then continuing. Run three rallies.',
          'On 2 of 3 rallies, both defensive balls come back AND the rally continues at least two more shots after the second one.'),
      ]),
      s('yellow', 2, 'Serve', [
        t('6 of 10 first serves in with real pace',
          'A first serve that is a weapon, not a formality.',
          '10 first serves, alternating boxes. Coach judges pace honestly: would this serve trouble a peer returner?',
          '6 of 10 in with committed pace. Ten dinks in a row scores zero.'),
        t('8 of 10 second serves in with spin — kick or slice, your choice',
          'A spin second serve — the single biggest separator at this level.',
          '10 second serves; coach watches for genuine spin: the ball curves or kicks, the racquet path brushes up or around it.',
          '8 of 10 in the box WITH visible spin. Flat pushed serves that land in do not count.'),
        t('Serve to the corner that is called, 4 of 6',
          'Serve placement on demand — serving to a plan.',
          "Coach calls 'T', 'body', or 'wide' before each of 6 serves, mixed order, both boxes.",
          '4 of 6 land in the called third of the box.'),
      ]),
      s('yellow', 3, 'Patterns', [
        t('Serve +1: serve wide, first ball to the open court, 4 of 6',
          'Playing the first two shots as one plan — the most common winning pattern in tennis.',
          'Player serves wide (deuce or ad, their pick); coach returns to the middle; player must take the next ball into the open court. Run 6 sequences.',
          '4 of 6 sequences: the serve lands in the wide third, the +1 ball lands in the open half.'),
        t('Run a 3-shot pattern the coach names, twice',
          'Executing tactics on request — proof the player can follow a game plan.',
          "Coach names a pattern — 'deep cross, deep cross, short angle', or 'backhand line, forehand cross, come in' — and the player runs it live against coach feeds.",
          'The named pattern executed correctly twice, in any reasonable number of tries.'),
        t('Say out loud what you are trying to do before the point starts',
          'Intentionality — a plan before every point, said out loud so the coach can hear the thinking.',
          "Before 4 practice points, coach asks: what's the plan? Player states one concrete intention.",
          "4 of 4 points have a real, specific plan — 'serve wide, attack the backhand'. 'Try to win' is not a plan."),
      ]),
      s('yellow', 4, 'Defense & Transition', [
        t('Slice or lob to reset from behind the baseline, 4 of 6',
          'Turning defense into neutral with height and depth instead of a hero shot.',
          'Coach attacks 6 balls that push the player well behind the baseline; the player must reset with a deep slice or lob.',
          '4 of 6 resets land past the service line, high enough that the coach cannot attack the next ball.'),
        t('Approach-and-volley combination won 4 of 6',
          'The full attacking transition against a live passer.',
          'Coach feeds short; player approaches and plays out the point against genuine (but fair) passing attempts. 6 points.',
          'Win 4 of 6 points at the net.'),
        t('Get back to neutral after being pushed into the back fence',
          'The deepest defensive position in tennis — and the way out of it.',
          'Coach drives the player toward the fence with two heavy deep balls, then continues the rally. Run 3 rallies.',
          'On 2 of 3, the player escapes the fence, works forward, and reaches a neutral baseline position within three shots.'),
      ]),
      s('yellow', 5, 'Competition', [
        t('Play a complete set with a tiebreak, fully self-officiated',
          'A real set including the pressure ending — run entirely by the players.',
          'A full set against a peer (play a tiebreak at the end regardless of score, to test the procedure), coach outside the fence.',
          'The set completes with correct tiebreak procedure — serve rotation, change of ends, and score all handled by the players.'),
        t('Play a USTA match or a club tournament',
          'Stepping into sanctioned competition — the bridge to High Performance.',
          'Any USTA junior event, UTR event, or official club tournament. The director verifies the result online.',
          'Complete one match. This is the invitation trigger: playing it means the player wants more.'),
        t('Have a UTR',
          'A rating that exists — proof of real matches on the record.',
          'The director looks the player up on UTR after their event.',
          'A UTR profile exists with at least one result. The number itself does not matter at all.'),
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

/** Strings a player holds inside one level, from their award stripe keys. */
export function stripesInLevel(level: LevelKey, awardKeys: string[]): number {
  return awardKeys.filter((k) => k.startsWith(`${level}-`)).length;
}

export const HOUSE_RULES = [
  'Test Day is the last class of every month — parents are invited to stay for the final 15 minutes.',
  "To test, a player must have attended 3 of the month's 4 classes.",
  'To test, a player must be registered for the next month.',
  'Not everyone passes — and that is the point. Passed tests are banked; retest only what is left next month.',
];

/** What clearing Yellow 5 / topping the ladder earns at Sleepy Hollow. */
export const SUMMIT_REWARDS = [
  'A club hoodie with your rank on the sleeve',
  'Your name on the board in the pro shop',
  'A match against the Director of Tennis',
];

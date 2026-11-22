/**
 * Racquets IRL landing page: every claim and every link, in one place.
 *
 * Rule for this file: only say what the product does today. Each line below was
 * checked against the code (11/22/26):
 *   - No login, no app: hosts are a device id (lib/play/passes), players join with a name (JoinBox).
 *   - First hosted game free, then Host Pass (lib/play/pricing). Joining is free.
 *   - Formats: A game (doubles/singles), Social mixer (Optimize Courts, rotating, mixed),
 *     King of the Court, Team Battle, Tournament draws (lib/play/draw) — HostClient TILES.
 *   - Share: WhatsApp / Text / Copy / Share sheet / QR (EventClient ShareBox).
 *   - Status sheet: who's in, who hasn't tapped (names from the notes), one-tap nudge.
 *   - Player cap + waitlist (status 'wait'), weekly repeat, Run it back.
 *   - Live: Start assigns courts and partners; anyone in the game enters scores;
 *     standings update; Next round draws fresh partners; End + recap writes up the night.
 *   - Games near me (/play/near): hosts can opt in to be listed so nearby players find it.
 */
export const CTA = {
  primary: { label: 'Create a game — Free', short: 'Create a game', href: '/play/new' },
  secondary: { label: 'See how it works', href: '#how' },
  fullDemo: { label: 'Watch a whole night in 60 seconds', href: '/play/demo' },
  join: { label: 'Find a game near me', href: '/play/near' },
  suite: { label: 'All ClubMode tools', href: '/platform' },
} as const;

export const TAGLINE = 'Racquet Sports. Together. In Real Life.';

export const HERO = {
  title: ['More playing.', 'Less planning.'] as const,
  sub: 'Create the game. Bring everyone together. Make every minute on court more fun.',
  sports: 'Tennis · Pickleball · Padel',
  trust: 'Free first game · No app, no login',
};

/**
 * Create it / Fill it / Play it, told on one real game: Friday Night Doubles, 8 players,
 * 2 courts (lib/play/demoStages). Each stage owns the phone screens that show it.
 * Captions never name partners: the pairing engine's shuffle differs by browser engine.
 */
export const STORY = [
  {
    key: 'create', label: 'Create it', title: 'Set up your game in seconds.',
    body: 'Pick a sport and a format, add when and where. Or just say it in one sentence.',
    screens: [{ id: 'create', caption: 'Jordan sets up Friday doubles: 2 courts, Lakeside Park.' }],
  },
  {
    key: 'fill', label: 'Fill it', title: 'One link. Everyone’s in.',
    body: 'Drop it in the group chat. Players tap in with just their name. No app, no account.',
    screens: [
      { id: 'share', caption: 'The link lands in the group chat.' },
      { id: 'fill', caption: '8 of 8 in. Jordan sees exactly who’s coming.' },
    ],
  },
  {
    key: 'play', label: 'Play it', title: 'Show up. Play. Have a blast.',
    body: 'Tap Start and every phone shows its court, partner and opponents. Scores go in from any phone.',
    screens: [
      { id: 'courts', caption: 'Maya’s phone: her court, partner and opponents.' },
      { id: 'next', caption: 'Round 2: a new partner, and the standings so far.' },
    ],
  },
] as const;

export const BENEFITS = {
  together: {
    title: 'Easier to organize.',
    points: [
      ['No app, no account.', 'Players tap in with a first name.'],
      ['Know who’s coming.', 'See who’s in and nudge the rest in one tap.'],
      ['Drop-outs covered.', 'Set a cap and the waitlist fills any spot that opens.'],
      ['Every week, sorted.', 'Turn on repeat and next week sets itself up.'],
    ],
  },
  court: {
    title: 'More fun to play.',
    points: [
      ['Courts in one tap.', 'No clipboard, no shouting across the fence.'],
      ['Fresh partners every round.', 'And every court stays full.'],
      ['Scores from any phone.', 'The standings move as the courts come in.'],
      ['A recap worth sharing.', 'A line for every player at the end of the night.'],
    ],
  },
} as const;

export const FORMATS = [
  { key: 'doubles', title: 'Doubles or singles', sub: 'Your regular game, on one court.' },
  { key: 'mixer', title: 'Social mixer', sub: 'Rotating partners, any headcount.' },
  { key: 'kotc', title: 'King of the Court', sub: 'Win and move up. Everyone wants Court 1.' },
  { key: 'tournament', title: 'Tournament', sub: 'Round robins, brackets, pools. Draw made for you.' },
] as const;

export const AUDIENCE = 'For whoever always ends up organizing: the friend who books the courts, pickleball group leaders, club pros and mixer hosts.';
export const FORMATS_ALSO = 'Tennis, pickleball and padel. Mixed doubles and team battles too.';

export const FINAL = {
  title: 'Your next great game starts here.',
  sub: 'Spend less time organizing. Spend more time playing.',
};

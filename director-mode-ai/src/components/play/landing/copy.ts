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
  trust: ['Tennis, pickleball & padel', 'No app or login, for you or your players', 'Your first game is free'],
};

export const STAGES = [
  {
    key: 'create', label: 'Create it', title: 'Set up your game in seconds.',
    body: 'Pick your sport and a format, add when and where. In a hurry? Type or say it in one sentence and the form fills itself in.',
  },
  {
    key: 'fill', label: 'Fill it', title: 'One link. Everyone’s in.',
    body: 'Drop the link in your group chat. Players tap in with just their name. You see who’s coming, and nudge the rest in one tap.',
  },
  {
    key: 'play', label: 'Play it', title: 'Show up. Play. Have a blast.',
    body: 'Tap Start and every phone shows its court, partner and opponents. Scores go in from any phone and the next round builds itself.',
  },
] as const;

export const DEMO_STEPS = [
  { key: 'create', title: 'Jordan creates the game', body: 'Sport, format, when and where, a first name. Done.' },
  { key: 'share', title: 'One link in the group chat', body: 'No app to download, no account to make.' },
  { key: 'fill', title: 'The roster fills itself', body: '8 of 8 in. Jordan sees exactly who’s coming.' },
  { key: 'courts', title: 'Everyone gets a court', body: 'Jordan taps Start. Maya’s phone shows her court, partner and opponents.' },
  { key: 'next', title: 'Scores in, next round ready', body: 'Scores from any phone, standings update live, fresh partners for round 2.' },
] as const;

export const BENEFITS = {
  together: {
    kicker: 'Bring everyone together',
    title: 'Less chasing. More yeses.',
    points: [
      'One link for the group chat: WhatsApp, text, or a QR code at the courts.',
      'Players join in seconds with a first name. No app, no account, no password.',
      'See who’s in at a glance, and nudge the group chat in one tap when you need a few more.',
      'Set a player cap and a waitlist fills any spot that opens up.',
      'Same time every week? Turn on repeat and next week’s game sets itself up.',
    ],
  },
  court: {
    kicker: 'Make it better on court',
    title: 'Not just an RSVP. It runs the games.',
    points: [
      'Courts, partners and opponents assigned in one tap. No clipboard, no shouting.',
      'Partners rotate each round, and the format is picked to keep every court full.',
      'Anyone in the game can enter a score. The standings update live.',
      'King of the Court, round robins, team battles: formats people want to play.',
      'At the end, a recap of the night with a line for every player.',
    ],
  },
} as const;

export const FORMATS = [
  { title: 'Casual doubles', sub: 'Or singles. One court, four players (or two). Your regular hit, organized.' },
  { title: 'Social mixer', sub: 'Rotating partners for any headcount. Every court full, every round.' },
  { title: 'King of the Court', sub: 'Win and move up, lose and move down. Everyone’s chasing Court 1.' },
  { title: 'Tournament', sub: 'Round robins, brackets, compass draws, pools with playoffs. The draw is made for you.' },
] as const;

export const AUDIENCE = 'For whoever always ends up organizing: the friend who books the courts, pickleball group leaders, club pros and social mixer hosts.';

export const FINAL = {
  title: 'Your next great game starts here.',
  sub: 'Spend less time organizing. Spend more time playing.',
};

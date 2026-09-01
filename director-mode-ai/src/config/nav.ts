/**
 * nav.ts — the single source of truth for ClubMode's navigation AND its product list.
 *
 * The app is organised into three AUDIENCE SPACES rather than one flat tool list:
 *
 *   1. "Run the club" — the default staff/director space. Five plain-English
 *                       sections (Courts, Programs, Members, Coaching, Pro shop),
 *                       each with a landing page under /run/*, plus "All tools".
 *   2. "For players"  — the handful of surfaces a member/player actually opens.
 *   3. "For you"      — the director's own career (Benchmarks, Recruiting).
 *                       Deliberately kept OUT of the primary nav: it is a different
 *                       value proposition from running the club. It lives in the
 *                       sidebar footer and the marketing footer only.
 *
 * NAMING RULE: `Section.label` is plain English and is what appears in nav.
 * `Tool.name` is the product BRAND (MixerMode, StringingMode, CoachMode, ...) and
 * is preserved on section landing pages and tool headers. Never rename a brand.
 *
 * URL RULE: this file must not change any existing tool URL. Sections are a
 * presentation layer on top of the routes that already exist, which keeps the
 * reorganisation reversible.
 *
 * ── THE COUNT ────────────────────────────────────────────────────────────────
 * Four places used to state how many tools ClubMode has and no two agreed: the
 * homepage hero said 9, the toolkit grid rendered 9, the nav listed 18, and the
 * true number was 15. Everything now derives from PRODUCTS / PRODUCT_COUNT below.
 *
 * A "product" is a branded, separately-sellable tool — the thing a director would
 * name if you asked what ClubMode does. `product: true` marks one. Deliberately
 * NOT products, which is why 15 and not 19:
 *   - "Members roster" — a page inside the app, not a brand.
 *   - The three "For players" surfaces — member-facing views of products that are
 *     already counted, not separate tools you would sell.
 * If you add a product, set `product: true` and every count, grid, footer and
 * directory page picks it up. Do not hardcode a number anywhere, ever again.
 */

import {
  LayoutGrid, CalendarDays, Shuffle, Calendar, Trophy, ClipboardList, Waves,
  Users, Database, Wrench, Clock, GraduationCap, Mountain, BarChart3, Sparkles,
  Grid3x3, User, CalendarRange, Search, CalendarCheck,
} from 'lucide-react';

export type NavIcon = typeof LayoutGrid;

export type Tool = {
  /** Product brand name — preserved verbatim. */
  name: string;
  href: string;
  /** Longest path prefix that should mark this tool active. Defaults to href. */
  match?: string;
  /** The job it does, in one line. Used by the directory and section pages. */
  description: string;
  icon: NavIcon;
  color: string;
  /** Counts toward PRODUCT_COUNT. See "THE COUNT" above. */
  product?: boolean;
  /** Uppercase category chip on the marketing grid. */
  tag?: string;
  /** Optional flag on the marketing grid, e.g. "NEW". */
  badge?: string;
  /** Longer, marketing-voice copy for the homepage grid. Falls back to `description`. */
  pitch?: string;
};

export type Section = {
  key: string;
  /** Plain-English nav label. */
  label: string;
  /** Section landing page. */
  href: string;
  blurb: string;
  icon: NavIcon;
  color: string;
  /** Path prefixes owned by this section, used to light it up in the rail. */
  matches: string[];
  tools: Tool[];
};

/* ========================= Space 1 — Run the club ========================= */

export const SECTIONS: Section[] = [
  {
    key: 'courts',
    label: 'Courts',
    href: '/run/courts',
    blurb: 'Who is on which court today, and what the year ahead looks like.',
    icon: LayoutGrid,
    color: '#22d3ee',
    matches: ['/run/courts', '/courtsheet', '/calendar'],
    tools: [
      {
        name: 'CourtSheet',
        href: '/courtsheet/staff',
        match: '/courtsheet',
        description: 'The live court grid — bookings, lessons and blocks on one screen, with an AI command layer.',
        pitch: 'The live grid of every court reservation across the club. Type or speak a command to book, move, or block.',
        icon: LayoutGrid,
        color: '#22d3ee',
        product: true,
        tag: 'COURTS',
      },
      {
        name: 'CalendarMode',
        href: '/calendar',
        match: '/calendar',
        description: 'Year planning. Score every weekend against your idea catalog and lock the season calendar.',
        pitch: 'Plan the whole year before it starts. Score every weekend against your idea catalog and lock the season calendar.',
        icon: CalendarDays,
        color: '#c084fc',
        product: true,
        tag: 'PLANNING',
      },
    ],
  },
  {
    key: 'programs',
    label: 'Programs',
    href: '/run/programs',
    blurb: 'Everything you put on the calendar for players — one engine, many formats.',
    icon: Shuffle,
    color: '#fb923c',
    matches: ['/run/programs', '/mixer', '/captain', '/swim', '/quads', '/leagues', '/tournaments'],
    tools: [
      {
        name: 'MixerMode',
        href: '/mixer/home',
        match: '/mixer/home',
        description: 'Socials, mixers and team battles. Build the lines, run the day, post the results.',
        pitch: 'Round robins, balanced team generation, tournaments and quads — live scores and standings across every format.',
        icon: Shuffle,
        color: '#fb923c',
        product: true,
        tag: 'EVENTS',
      },
      {
        name: 'LeagueMode',
        href: '/mixer/leagues',
        match: '/mixer/leagues',
        description: 'Multi-week leagues and Junior Team Tennis — rosters, match days, standings, coach scoring.',
        pitch: 'Run full team leagues and Junior Team Tennis — strength-ordered rosters, auto-laddering, two-site match days, and magic-link coach scoring.',
        icon: Calendar,
        color: '#34d399',
        product: true,
        tag: 'LEAGUES',
        badge: 'NEW',
      },
      {
        name: 'TournamentMode',
        href: '/mixer/tournaments',
        match: '/mixer/tournaments',
        description: 'Draws and brackets — single elim, consolation, round robin, compass.',
        pitch: 'Every draw type that matters: single elimination, first-match and full feed-in consolation, round robin, and compass.',
        icon: Trophy,
        color: '#eab308',
        product: true,
        tag: 'DRAWS',
      },
      {
        name: 'CaptainMode',
        href: '/captain',
        match: '/captain',
        description: 'The captain-facing view of your league data: availability, lineups and confirmations.',
        pitch: 'Hand your captains their own console — availability, strength-ordered lineups, and player confirmations without a single group text.',
        icon: ClipboardList,
        color: '#D3FB52',
        product: true,
        tag: 'CAPTAINS',
      },
      {
        name: 'SwimMode',
        href: '/swim',
        match: '/swim',
        description: 'Swim team volunteer points and family signup.',
        pitch: 'Volunteer points tracker for swim team leads — define jobs, track family points all season, CSV in and out.',
        icon: Waves,
        color: '#38bdf8',
        product: true,
        tag: 'SWIM TEAM',
      },
    ],
  },
  {
    key: 'members',
    label: 'Members',
    href: '/run/members',
    blurb: 'Who belongs to the club, what you know about them, and how they find each other.',
    icon: Users,
    color: '#38bdf8',
    matches: ['/run/members', '/club/members', '/courtconnect'],
    tools: [
      {
        // Not a product: a page inside the app, no brand. See "THE COUNT".
        name: 'Members roster',
        href: '/club/members',
        match: '/club/members',
        description: 'Your club membership list — invites, roles and account access.',
        icon: Users,
        color: '#38bdf8',
      },
      {
        name: 'PlayerVault',
        href: '/courtconnect/vault',
        match: '/courtconnect/vault',
        description: 'The people hub. Roster players and member accounts merged into one searchable table.',
        pitch: 'Club roster CRM with NTRP/UTR ratings, UTR auto-lookup, and bulk CourtConnect import.',
        icon: Database,
        color: '#2dd4bf',
        product: true,
        tag: 'ROSTER',
      },
      {
        name: 'CourtConnect',
        href: '/courtconnect/home',
        match: '/courtconnect/home',
        description: 'Player-to-player matching — members post games and find partners at their level.',
        pitch: 'Match players by skill level, create events, and manage RSVPs with automatic waitlists.',
        icon: Users,
        color: '#34d399',
        product: true,
        tag: 'PLAYERS',
      },
    ],
  },
  {
    key: 'coaching',
    label: 'Coaching',
    href: '/run/coaching',
    blurb: 'Lessons on the books, feedback after them, and the pathway juniors climb.',
    icon: GraduationCap,
    color: '#60a5fa',
    matches: ['/run/coaching', '/lessons', '/pathway'],
    tools: [
      {
        name: 'LastMinuteLesson',
        href: '/lessons/dashboard',
        match: '/lessons/dashboard',
        description: 'Fill open lesson slots — clients, availability blasts and booking history.',
        pitch: 'Post open lesson slots, notify clients instantly, and let them book in one tap.',
        icon: Clock,
        color: '#60a5fa',
        product: true,
        tag: 'LESSONS',
      },
      {
        name: 'Open Lesson Time',
        href: '/lessons/open',
        match: '/lessons/open',
        description: 'Your Google Calendar is the booking page — block "Open Lesson Time" and clients book 30, 60 or 90 minutes of it.',
        pitch: "Every instructor connects their own calendar; clients book the club's open times in one tap, no account.",
        icon: CalendarCheck,
        color: '#34d399',
        product: true,
        tag: 'LESSONS',
      },
      {
        name: 'CoachMode',
        href: '/lessons/recap',
        match: '/lessons/recap',
        description: 'AI lesson recaps and drills — what you worked on, sent to the player.',
        pitch: "Track each player's development over time and get an AI summary after every lesson.",
        icon: GraduationCap,
        color: '#a78bfa',
        product: true,
        tag: 'DEVELOPMENT',
      },
      {
        name: 'PathwayMode',
        href: '/pathway',
        match: '/pathway',
        description: 'The junior pathway. Kids climb the ball colors earning stripes; families follow along.',
        pitch: 'Give juniors a ladder to climb. Kids earn strings through the ball colors, and families follow the whole journey from their phone.',
        icon: Mountain,
        color: '#eab308',
        product: true,
        tag: 'JUNIORS',
      },
    ],
  },
  {
    key: 'pro-shop',
    label: 'Pro shop',
    href: '/run/pro-shop',
    blurb: 'The counter side of the club.',
    icon: Wrench,
    color: '#f472b6',
    matches: ['/run/pro-shop', '/stringing'],
    tools: [
      {
        name: 'StringingMode',
        href: '/stringing/jobs',
        match: '/stringing',
        description: 'Stringing jobs, customers and the string catalog — from drop-off to pickup.',
        pitch: 'AI string recommendations, job tracking from drop-off to pickup, customer history, and inventory.',
        icon: Wrench,
        color: '#f472b6',
        product: true,
        tag: 'PRO SHOP',
      },
    ],
  },
];

/* ========================= Space 2 — For players ========================= */
/**
 * Member-facing views of products already counted above — not separate tools,
 * so none of these carry `product: true`. See "THE COUNT".
 */
export const FOR_PLAYERS: Tool[] = [
  {
    name: 'My account',
    href: '/client/dashboard',
    match: '/client/dashboard',
    description: "A player's own home: upcoming bookings, lessons and history.",
    icon: User,
    color: '#60a5fa',
  },
  {
    name: 'Events',
    href: '/courtconnect/events',
    match: '/courtconnect/events',
    description: 'What is on at the club, and how to get into it.',
    icon: CalendarRange,
    color: '#34d399',
  },
  {
    name: 'Find a coach',
    href: '/find-coach',
    match: '/find-coach',
    description: 'Browse coaches and request a lesson.',
    icon: Search,
    color: '#a78bfa',
  },
];

/* ========================== Space 3 — For you ========================== */
/**
 * The director's own career, not the club's operations. Kept out of the primary
 * nav on purpose — it is surfaced in the sidebar footer and the marketing footer.
 * Both ARE products: they are branded and separately sellable.
 */
export const FOR_YOU: Tool[] = [
  {
    name: 'Benchmarks',
    href: '/benchmarks',
    match: '/benchmarks',
    description: 'What directors like you earn. Comp score, comp advisor and your total-comp profile.',
    pitch: 'See what directors like you actually earn, from real 990 filings — then build the case for your own number.',
    icon: BarChart3,
    color: '#f59e0b',
    product: true,
    tag: 'YOUR PAY',
  },
  {
    name: 'Recruiting',
    href: '/connect',
    match: '/connect',
    description: 'Talent to club matchmaking. See who is hiring and let clubs find you.',
    pitch: 'Talent meets club. See who is hiring, and let clubs find you without posting your résumé anywhere public.',
    icon: Sparkles,
    color: '#2dd4bf',
    product: true,
    tag: 'YOUR CAREER',
  },
];

/* ============================== Helpers ============================== */

/** Every "Run the club" entry, flattened — products and non-products alike. */
export const ALL_CLUB_TOOLS: Tool[] = SECTIONS.flatMap((s) => s.tools);

/**
 * THE canonical product list. Every count, grid, footer and directory page reads
 * from here. Ordered the way the nav is ordered, so the marketing grid and the
 * directory tell the same story in the same sequence.
 */
export const PRODUCTS: Tool[] = [...ALL_CLUB_TOOLS, ...FOR_YOU].filter((t) => t.product);

/** How many tools ClubMode has. Never write this number by hand. */
export const PRODUCT_COUNT = PRODUCTS.length;

/** The sixth "Run the club" nav item — the full directory at /tools. */
export const ALL_TOOLS_ITEM = {
  label: 'All tools',
  href: '/tools',
  icon: Grid3x3,
  color: '#94a3b8',
  matches: ['/tools', '/run/tools'],
};

export function findSection(key: string): Section | undefined {
  return SECTIONS.find((s) => s.key === key);
}

/** The section a given product belongs to, for grouping the directory. */
export function sectionOf(tool: Tool): Section | undefined {
  return SECTIONS.find((s) => s.tools.some((t) => t.href === tool.href));
}

/**
 * Longest-prefix match: returns the href of the nav entry that should render as
 * active for `pathname`, given a list of candidate entries.
 */
export function activeHref(
  pathname: string,
  entries: { href: string; matches: string[] }[],
): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const e of entries) {
    for (const m of e.matches) {
      const hit = m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(m + '/');
      if (hit && m.length > bestLen) { best = e.href; bestLen = m.length; }
    }
  }
  return best;
}

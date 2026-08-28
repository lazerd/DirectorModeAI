/**
 * nav.ts — the single source of truth for ClubMode's navigation.
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
 */

import {
  LayoutGrid, CalendarDays, Shuffle, Calendar, Trophy, ClipboardList, Waves,
  Users, Database, Wrench, Clock, GraduationCap, Mountain, BarChart3, Sparkles,
  Grid3x3, User, CalendarRange, Search,
} from 'lucide-react';

export type NavIcon = typeof LayoutGrid;

export type Tool = {
  /** Product brand name — preserved verbatim. */
  name: string;
  href: string;
  /** Longest path prefix that should mark this tool active. Defaults to href. */
  match?: string;
  description: string;
  icon: NavIcon;
  color: string;
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
        icon: LayoutGrid,
        color: '#22d3ee',
      },
      {
        name: 'CalendarMode',
        href: '/calendar',
        match: '/calendar',
        description: 'Year planning. Score every weekend against your idea catalog and lock the season calendar.',
        icon: CalendarDays,
        color: '#c084fc',
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
        icon: Shuffle,
        color: '#fb923c',
      },
      {
        name: 'LeagueMode',
        href: '/mixer/leagues',
        match: '/mixer/leagues',
        description: 'Multi-week leagues and Junior Team Tennis — rosters, match days, standings, coach scoring.',
        icon: Calendar,
        color: '#34d399',
      },
      {
        name: 'TournamentMode',
        href: '/mixer/tournaments',
        match: '/mixer/tournaments',
        description: 'Draws and brackets — single elim, consolation, round robin, compass.',
        icon: Trophy,
        color: '#eab308',
      },
      {
        name: 'CaptainMode',
        href: '/captain',
        match: '/captain',
        description: 'The captain-facing view of your league data: availability, lineups and confirmations.',
        icon: ClipboardList,
        color: '#D3FB52',
      },
      {
        name: 'SwimMode',
        href: '/swim',
        match: '/swim',
        description: 'Swim team volunteer points and family signup.',
        icon: Waves,
        color: '#38bdf8',
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
        icon: Database,
        color: '#2dd4bf',
      },
      {
        name: 'CourtConnect',
        href: '/courtconnect/home',
        match: '/courtconnect/home',
        description: 'Player-to-player matching — members post games and find partners at their level.',
        icon: Users,
        color: '#34d399',
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
        icon: Clock,
        color: '#60a5fa',
      },
      {
        name: 'CoachMode',
        href: '/lessons/recap',
        match: '/lessons/recap',
        description: 'AI lesson recaps and drills — what you worked on, sent to the player.',
        icon: GraduationCap,
        color: '#a78bfa',
      },
      {
        name: 'PathwayMode',
        href: '/pathway',
        match: '/pathway',
        description: 'The junior pathway. Kids climb the ball colors earning stripes; families follow along.',
        icon: Mountain,
        color: '#eab308',
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
        icon: Wrench,
        color: '#f472b6',
      },
    ],
  },
];

/* ========================= Space 2 — For players ========================= */

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
 */
export const FOR_YOU: Tool[] = [
  {
    name: 'Benchmarks',
    href: '/benchmarks',
    match: '/benchmarks',
    description: 'What directors like you earn. Comp score, comp advisor and your total-comp profile.',
    icon: BarChart3,
    color: '#f59e0b',
  },
  {
    name: 'Recruiting',
    href: '/connect',
    match: '/connect',
    description: 'Talent to club matchmaking. See who is hiring and let clubs find you.',
    icon: Sparkles,
    color: '#2dd4bf',
  },
];

/* ============================== Helpers ============================== */

/** Every "Run the club" tool, flattened — used by the All tools page. */
export const ALL_CLUB_TOOLS: Tool[] = SECTIONS.flatMap((s) => s.tools);

/** The sixth "Run the club" nav item. Its page is built out in Task 3. */
export const ALL_TOOLS_ITEM = {
  label: 'All tools',
  href: '/run/tools',
  icon: Grid3x3,
  color: '#94a3b8',
  matches: ['/run/tools'],
};

export function findSection(key: string): Section | undefined {
  return SECTIONS.find((s) => s.key === key);
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

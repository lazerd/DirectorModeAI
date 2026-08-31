import { CalendarClock, Users, ListOrdered, Send, CheckCircle2, Trophy, AlertTriangle } from 'lucide-react';

/**
 * "What do I do next" — the one line the match page was missing.
 *
 * The page shows Availability, Lineup and Results at equal visual weight, all
 * the time. But a captain opening it ten days out and a captain opening it on
 * match morning need completely different things, and nothing on the page said
 * which of those you were. You had to read three sections and work it out.
 *
 * This reads the same state the sections already derive and names the single
 * next action. It is deliberately not a wizard: everything below stays
 * reachable, because captains skip steps and come back to them.
 */

export type MatchStage =
  | 'poll'          // nobody has been asked yet
  | 'waiting'       // asked, not enough answers to fill the lineup
  | 'build'         // enough available, no lineup yet
  | 'send'          // lineup built, not sent
  | 'confirm'       // sent, waiting on players to confirm
  | 'bailed'        // someone withdrew from a sent lineup — needs a sub
  | 'ready'         // everyone confirmed, match not played
  | 'results';      // match is done, scores outstanding

export function matchStage(x: {
  answered: number;
  available: number;
  needed: number;
  lineupFilled: number;
  lineupSent: boolean;
  confirmed: number;
  bailed: number;
  played: boolean;
  matchPast: boolean;
}): MatchStage {
  if (x.played || (x.matchPast && x.lineupSent)) return 'results';
  if (x.bailed > 0 && x.lineupSent) return 'bailed';
  if (!x.answered) return 'poll';
  if (x.lineupSent) return x.confirmed >= x.lineupFilled && x.lineupFilled > 0 ? 'ready' : 'confirm';
  if (x.lineupFilled >= x.needed) return 'send';
  if (x.available >= x.needed) return 'build';
  return 'waiting';
}

const COPY: Record<
  MatchStage,
  { icon: typeof Users; tone: string; title: string; body: (n: Record<string, number>) => string }
> = {
  poll: {
    icon: Users, tone: '#D3FB52',
    title: 'Ask the team who can play',
    body: () => 'Nobody has been asked yet. One email, three buttons, no logins.',
  },
  waiting: {
    icon: CalendarClock, tone: '#fbbf24',
    title: 'Waiting on answers',
    body: (n) => `${n.available} available, ${n.needed - n.available} short of a full lineup. Nudge whoever hasn't replied.`,
  },
  build: {
    icon: ListOrdered, tone: '#D3FB52',
    title: 'Build the lineup',
    body: (n) => `${n.available} available for ${n.needed} spots. Generate it, then drag anything you disagree with.`,
  },
  send: {
    icon: Send, tone: '#D3FB52',
    title: 'Send the lineup',
    body: () => 'Built but not sent. It goes to the whole team, so nobody has to ask whether they are playing.',
  },
  confirm: {
    icon: CheckCircle2, tone: '#fbbf24',
    title: 'Waiting on confirmations',
    body: (n) => `${n.confirmed} of ${n.lineupFilled} have confirmed. The rest are the ones who go quiet and then bail.`,
  },
  bailed: {
    icon: AlertTriangle, tone: '#f87171',
    title: 'Someone dropped out',
    body: (n) => `${n.bailed} withdrew after the lineup went out. Find a sub before this becomes a match-morning problem.`,
  },
  ready: {
    icon: CheckCircle2, tone: '#34d399',
    title: 'Everyone is confirmed',
    body: () => 'Nothing to do until the match. Scores go in afterwards.',
  },
  results: {
    icon: Trophy, tone: '#D3FB52',
    title: 'Enter the scores',
    body: () => 'Court by court. This is what feeds play counts, playoff eligibility and partnership records.',
  },
};

export default function MatchNextStep({
  stage,
  counts,
}: {
  stage: MatchStage;
  counts: Record<string, number>;
}) {
  const c = COPY[stage];
  const Icon = c.icon;
  return (
    <div
      className="rounded-2xl border p-5"
      style={{ borderColor: `${c.tone}40`, background: `${c.tone}0f` }}
    >
      <div className="flex items-start gap-4">
        <span
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: `${c.tone}1f`, color: c.tone }}
        >
          <Icon size={21} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-white/35">
            Next
          </p>
          <h2 className="mt-0.5 text-[19px] font-semibold tracking-tight text-white">{c.title}</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-white/55">{c.body(counts)}</p>
        </div>
      </div>
    </div>
  );
}

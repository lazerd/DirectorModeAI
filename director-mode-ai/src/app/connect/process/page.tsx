import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PLACEMENT_FEE_USD } from '@/lib/connect/placement';

export const metadata: Metadata = {
  title: 'Our recruiting process · ClubMode Recruiting',
  description: `The end-to-end ClubMode Recruiting process. AI-powered, human-led, and you pay $${PLACEMENT_FEE_USD.toLocaleString()} only when you hire.`,
};

const FEE = `$${PLACEMENT_FEE_USD.toLocaleString()}`;

// Darrin's 10-step client process (10/22/2026). What a club can expect from us, start to finish.
const STEPS: { title: string; points: string[]; output: string }[] = [
  {
    title: 'Find opportunities with AI',
    points: [
      'AI scans job boards, club websites and industry sources for new openings.',
      'Identifies director-level and key racquets roles (tennis, pickleball, padel).',
      'Pulls key details and links to the original posting.',
      'Matches each club to its Form 990 and financial context.',
    ],
    output: 'Prioritized list of qualified openings with club and financial insights',
  },
  {
    title: 'Identify the 5–10 best candidates with AI',
    points: [
      'AI analyzes the job description, requirements and club context.',
      'Searches our network of opted-in candidates and directors nationwide.',
      'Ranks the top 5–10 qualified candidates on experience, location, compensation and fit.',
      'Darrin and Kevin review and approve the shortlist before any outreach.',
    ],
    output: '5–10 best-fit candidates ranked by AI match score',
  },
  {
    title: 'Personal outreach to the club',
    points: [
      'Darrin or Kevin personally reaches out to the GM or board with a tailored note.',
      'We share useful insight: candidate availability and market context.',
      'We propose a conversation and invite the club to activate the search on ClubMode.',
      'No automated cold emails. Always human to human.',
    ],
    output: 'Interested club and a meeting or next step scheduled',
  },
  {
    title: 'Confirm the agreement',
    points: [
      'The club signs in to ClubMode and accepts the placement terms:',
      `${FEE} only if you hire a candidate we introduce. No upfront fees or retainers.`,
      'One free replacement search if the hire leaves within 90 days.',
      'Applies to candidates we introduce, hired within 12 months.',
      'The club makes the final hiring decision.',
    ],
    output: 'Signed agreement and an active search',
  },
  {
    title: 'AI-native job intake',
    points: [
      'A thorough online survey any stakeholder can complete: GM, board, tennis chair.',
      '30–50 questions covering the club, program, role, compensation, timeline and success criteria.',
      'Creates a detailed, standardized job profile for AI matching.',
    ],
    output: 'Complete job profile and hiring requirements',
  },
  {
    title: 'Present the 5–10 best candidates',
    points: [
      'We present the top candidates with résumés, AI fit summaries, match scores and key strengths.',
      'We explain why each candidate is a strong fit for the club’s needs.',
      'Every candidate has opted in and agreed to be presented to your club.',
    ],
    output: '5–10 vetted candidates, ranked, ready for interviews',
  },
  {
    title: 'Coordinate first-round video interviews',
    points: [
      'We schedule and coordinate video interviews with the club and candidates.',
      'We provide interview questions and context.',
      'We collect feedback from both sides and keep the process moving.',
    ],
    output: 'Interview feedback and 1–2 finalists',
  },
  {
    title: 'Coordinate onsite final interviews',
    points: [
      'We coordinate in-person interviews at the club.',
      'Including meetings with the GM, board and key stakeholders.',
      'We help with scheduling, logistics and any additional information needed.',
    ],
    output: 'Final candidate(s) and a hiring decision',
  },
  {
    title: 'Hire and onboard',
    points: [
      'The club makes the final hiring decision.',
      'The candidate accepts the offer and starts the position.',
      'We stay available to support the transition and answer questions.',
    ],
    output: 'A successful placement',
  },
  {
    title: 'Fee payment',
    points: [
      `The ${FEE} placement fee is due on the candidate’s first day of work.`,
      'We send an invoice (or collect through the platform) with the placement details.',
      'If the hire leaves within 90 days, we run one free replacement search.',
    ],
    output: 'Payment received and search closed',
  },
];

export default function RecruitingProcessPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      <Link href="/connect" className="text-sm text-teal-400 underline">ClubMode Recruiting</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">The end-to-end recruiting process</h1>
          <p className="mt-2 text-lg text-slate-300">AI-powered. Fast. Accurate. You pay only when you hire.</p>
        </div>
        <div className="rounded-xl border border-teal-400/30 bg-teal-400/10 px-5 py-3 text-center">
          <div className="text-3xl font-bold text-white">{FEE}</div>
          <div className="text-sm font-semibold text-teal-200">Only when you hire</div>
          <div className="text-xs text-slate-300">No retainer. No upfront fees.</div>
        </div>
      </div>

      <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col rounded-xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-600 font-bold text-white">
                {i + 1}
              </span>
              <h2 className="font-semibold text-white">{s.title}</h2>
            </div>
            <ul className="mt-3 flex-1 list-disc space-y-1 pl-5 text-sm text-slate-300">
              {s.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div className="mt-4 rounded-lg bg-teal-400/10 px-3 py-2 text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-teal-300">Output</span>
              <span className="text-slate-200">{s.output}</span>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/connect/clubs"
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 font-semibold text-white hover:bg-teal-500"
        >
          Start a search <ArrowRight className="h-4 w-4" />
        </Link>
        <Link href="/connect/jobs" className="self-center text-sm text-teal-400 underline">See open positions</Link>
      </div>
    </div>
  );
}

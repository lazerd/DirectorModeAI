import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, CalendarCheck, ShieldCheck, Target, Users } from 'lucide-react';
import { PLACEMENT_FEE_USD } from '@/lib/connect/placement';

export const metadata: Metadata = {
  title: 'How we hire · ClubMode Recruiting',
  description: `The smarter way to hire your next racquets professional. Qualified candidates, a simple process, and you pay $${PLACEMENT_FEE_USD.toLocaleString()} only when you hire.`,
};

const FEE = `$${PLACEMENT_FEE_USD.toLocaleString()}`;
const CARD = '/connect/recruiting-process.png';

const PROMISES = [
  { icon: Target, title: 'AI-powered candidate matching', body: 'Finds the right people, faster.' },
  { icon: Users, title: 'Pre-qualified candidates', body: 'Experienced, interested and ready to talk.' },
  { icon: ShieldCheck, title: 'No upfront fees', body: 'You only pay when you hire.' },
  { icon: CalendarCheck, title: 'One free replacement search', body: 'If the hire leaves within 90 days.' },
];

// Darrin's client-facing card (10/22/2026): what a club can expect from us, start to finish.
const STEPS: { title: string; points: string[]; output: string }[] = [
  {
    title: 'Tell us about your opening',
    points: [
      'Complete a simple online intake form (30–50 questions).',
      'Any club stakeholder can fill it out.',
      'Gives us a clear, detailed understanding of your needs.',
    ],
    output: 'A complete, accurate job profile',
  },
  {
    title: 'We find the best candidates',
    points: [
      'Our AI searches our network of directors and opted-in candidates.',
      'We identify 5–10 of the best candidates based on your requirements.',
      'Every candidate is qualified, interested and a strong fit.',
    ],
    output: '5–10 qualified candidates ranked by best fit',
  },
  {
    title: 'Review & select candidates',
    points: [
      'Review candidate profiles, résumés and AI summaries in your private portal.',
      'Select 2–3 candidates to move forward.',
      "We're here to answer questions and provide insights.",
    ],
    output: '2–3 candidates selected for interviews',
  },
  {
    title: 'Interview finalists',
    points: [
      'We coordinate first-round video interviews with your selected candidates.',
      'Collect feedback and help you move to final candidates.',
    ],
    output: 'Interview feedback and 1–2 finalists',
  },
  {
    title: 'Meet finalists in person',
    points: [
      'We help coordinate on-site interviews at your club.',
      'Meet with the GM, board and key stakeholders.',
      'We facilitate scheduling and provide any additional information you need.',
    ],
    output: 'Confident finalist(s) ready for your decision',
  },
  {
    title: 'Make the hire, pay only on success',
    points: [
      'You make the final hiring decision.',
      'The candidate starts the position.',
      `The ${FEE} placement fee is paid on the candidate’s first day of work.`,
      'If the hire leaves within 90 days, we conduct one free replacement search.',
    ],
    output: 'A successful placement and a stronger program',
  },
];

export default function RecruitingProcessPage() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <Link href="/connect" className="text-sm text-teal-400 underline">ClubMode Recruiting</Link>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">The smarter way to hire your next racquets professional</h1>
          <p className="mt-2 text-lg text-slate-300">Qualified candidates. A simple process. You pay only when you hire.</p>
        </div>
        <div className="rounded-xl border border-teal-400/30 bg-teal-400/10 px-5 py-3 text-center">
          <div className="text-3xl font-bold text-white">{FEE}</div>
          <div className="text-sm font-semibold text-teal-200">Only when you hire</div>
          <div className="text-xs text-slate-300">No retainer. No upfront fees.</div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PROMISES.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-4">
            <Icon className="h-5 w-5 text-teal-400" />
            <h2 className="mt-2 text-sm font-semibold uppercase tracking-wide text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-300">{body}</p>
          </div>
        ))}
      </div>

      <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      <div className="mt-10 rounded-xl border border-white/10 bg-white/5 p-6 sm:flex sm:items-center sm:justify-between">
        <div>
          <p className="text-2xl font-bold text-white">Great people build great programs.</p>
          <p className="mt-1 text-slate-300">Let us help you find your next racquets professional.</p>
        </div>
        <Link
          href="/connect/clubs"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 font-semibold text-white hover:bg-teal-500 sm:mt-0"
        >
          Get started <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <p className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <BadgeCheck className="h-4 w-4" />
          <a href={CARD} target="_blank" rel="noreferrer" className="text-teal-400 underline">Download the one-page overview</a>
        </span>
        <Link href="/connect/jobs" className="text-teal-400 underline">See open positions</Link>
      </p>
    </div>
  );
}

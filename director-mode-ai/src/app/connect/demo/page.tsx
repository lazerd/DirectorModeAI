import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, CheckCircle2, ExternalLink, Lock, Mail, ShieldCheck, UserCheck } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { GUARANTEE_DAYS, PLACEMENT_FEE_USD, PLACEMENT_TERMS } from '@/lib/connect/placement';
import { MIN_CONFIRMED_FOR_PITCH } from '@/lib/connect/recruiter/policy';
import {
  candidateInviteEmail,
  claimLink,
  clubPitchEmail,
  openingLink,
  prospectRecruitEmail,
  sourcedJobLink,
} from '@/lib/connect/recruiter/outreach';

// A walkthrough for partners (Kevin) of the whole recruiting product: the weekly flywheel,
// every email it sends, and what clubs and candidates see. Unlisted and not indexed.
export const metadata: Metadata = {
  title: 'Recruiting product tour · ClubMode',
  robots: { index: false, follow: false },
};
export const revalidate = 3600;

const FEE = `$${PLACEMENT_FEE_USD.toLocaleString()}`;

// Sample data. Fictional club and people, so nothing here is about a real search.
const JOB = { club_name: 'Lakeside Country Club', title: 'Director of Racquets', city: 'Charlotte', state: 'NC', comp_text: '$140,000–$165,000' };
const DEMO_ID = '00000000-demo';

async function liveNumbers() {
  try {
    const db = getSupabaseAdmin();
    const head = { count: 'exact' as const, head: true };
    const [jobs, dirs, contacts, emails, cands] = await Promise.all([
      db.from('connect_sourced_jobs').select('id', head).eq('status', 'active'),
      db.from('connect_sourced_jobs').select('id', head).eq('status', 'active').in('role_level', ['director', 'gm']),
      db.from('connect_club_contacts').select('id', head),
      db.from('connect_club_contacts').select('id', head).not('email', 'is', null),
      db.from('connect_candidates').select('id', head),
    ]);
    return { jobs: jobs.count ?? 0, dirs: dirs.count ?? 0, contacts: contacts.count ?? 0, emails: emails.count ?? 0, cands: cands.count ?? 0 };
  } catch {
    return null;
  }
}

type Email = { key: string; who: string; when: string; approval: string; auto: boolean; subject: string; html: string };

function emails(): Email[] {
  const publicAlert = candidateInviteEmail(JOB, 'Jordan Ellis', sourcedJobLink(DEMO_ID));
  const retainedAlert = candidateInviteEmail(JOB, 'Jordan Ellis', openingLink(DEMO_ID), true);
  const personal = prospectRecruitEmail(JOB, { name: 'Sam Rivera', club: 'Oak Hollow Club' }, sourcedJobLink(DEMO_ID));
  const pitch = { club: JOB.club_name, title: JOB.title, contactName: 'Pat Morgan', newSinceLast: 0, memo: null, claimUrl: claimLink(DEMO_ID) };
  const first = clubPitchEmail(1, ['intro'], { ...pitch, interested: 3 });
  const second = clubPitchEmail(2, ['new_candidates', 'comp_memo'], {
    ...pitch,
    interested: 5,
    newSinceLast: 2,
    memo: { year: '2024', title: 'Director of Tennis', comp: 128400, revenue: 14_200_000, peers: 23, median: 151000, p75: 176500 },
  });
  return [
    {
      key: 'alert-public', who: 'Candidate (opted in)', auto: true,
      when: 'Tuesday, when a public listing fits their profile on role, location and pay',
      approval: 'Sends automatically. They asked for job alerts.',
      ...publicAlert,
    },
    {
      key: 'alert-retained', who: 'Candidate (opted in)', auto: true,
      when: 'Tuesday, when a club hiring through ClubMode fits their profile',
      approval: 'Sends automatically.',
      ...retainedAlert,
    },
    {
      key: 'personal', who: 'Director not yet in our network', auto: false,
      when: 'When the AI ranks them a strong step-up fit (found through 990 filings)',
      approval: 'Draft only. Darrin or Kevin adds a real email and approves it.',
      ...personal,
    },
    {
      key: 'pitch-1', who: 'GM / board member', auto: false,
      when: `Only after ${MIN_CONFIRMED_FOR_PITCH}+ candidates have said "present me to this club"`,
      approval: 'Draft only. Darrin or Kevin approves. The count is re-checked at send.',
      ...first,
    },
    {
      key: 'pitch-2', who: 'GM / board member (follow-up)', auto: false,
      when: 'At least 7 days later, only if there is something new. Max 3 emails, ever.',
      approval: 'Draft only. Darrin or Kevin approves.',
      ...second,
    },
    {
      key: 'hired-club', who: 'Club, on hire', auto: true,
      when: 'The moment the club marks a candidate hired with a start date',
      approval: 'Sends automatically, and Darrin gets the placement record to invoice.',
      subject: 'Congratulations on hiring Jordan Ellis',
      html: `<p>Congratulations — you've hired <strong>Jordan Ellis</strong> as Director of Racquets at Lakeside Country Club.</p>
<p>As agreed when you posted the opening, the ClubMode placement fee of <strong>${FEE}</strong> is due on their start date, <strong>Jan 4, 2027</strong>. We'll send an invoice.</p>
<p>If Jordan leaves within ${GUARANTEE_DAYS} days of starting (by Apr 4, 2027), we'll run one replacement search at no charge.</p>
<p>Questions? Just reply to this email.</p>`,
    },
  ];
}

// The loop, drawn as six stations on a ring.
const STATIONS = [
  { n: 1, title: 'Scout', day: 'Every Monday', body: 'AI reads the job boards, matches each club to its 990, estimates pay, finds the GM and board.' },
  { n: 2, title: 'Recruiter', day: 'Every Tuesday', body: 'AI turns each job into an ideal-candidate profile and ranks directors by pay band, distance and fit.' },
  { n: 3, title: 'Candidates say yes', day: 'Candidate-first', body: 'Fitting directors hear about the job. They count only after they click "present me to this club."' },
  { n: 4, title: 'Club outreach', day: `${MIN_CONFIRMED_FOR_PITCH}+ confirmed`, body: 'Darrin or Kevin approve a short note to the GM or board: real, interested candidates, no retainer.' },
  { n: 5, title: 'Search on ClubMode', day: 'Club accepts terms', body: 'Candidates drop into the club’s pipeline with résumés, AI fit scores and interview questions.' },
  { n: 6, title: 'Hire', day: `${FEE} on start date`, body: 'Club marks the hire. Placement record, invoice and a 90-day replacement guarantee.' },
];

function Flywheel() {
  const R = 150;
  const C = 200;
  const pts = STATIONS.map((_, i) => {
    const a = (-90 + i * 60) * (Math.PI / 180);
    return { x: C + R * Math.cos(a), y: C + R * Math.sin(a) };
  });
  return (
    <svg viewBox="0 0 400 400" className="w-full max-w-[420px] mx-auto" role="img" aria-label="The six-step recruiting flywheel">
      <defs>
        <marker id="arw" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" fill="#2dd4bf" />
        </marker>
      </defs>
      <circle cx={C} cy={C} r={R} fill="none" stroke="#134e4a" strokeWidth="18" />
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        const mx = (p.x + q.x) / 2;
        const my = (p.y + q.y) / 2;
        const k = 1.12;
        return (
          <path
            key={i}
            d={`M${p.x},${p.y} Q${C + (mx - C) * k},${C + (my - C) * k} ${q.x},${q.y}`}
            fill="none" stroke="#2dd4bf" strokeWidth="2" markerEnd="url(#arw)" strokeDasharray="1 0"
            pathLength={100} strokeDashoffset={0}
          />
        );
      })}
      <text x={C} y={C - 10} textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="700">{FEE}</text>
      <text x={C} y={C + 12} textAnchor="middle" fill="#99f6e4" fontSize="12">only when a club hires</text>
      <text x={C} y={C + 30} textAnchor="middle" fill="#94a3b8" fontSize="11">every hire grows the network</text>
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="26" fill="#0d9488" stroke="#0f172a" strokeWidth="4" />
          <text x={p.x} y={p.y + 6} textAnchor="middle" fill="#fff" fontSize="18" fontWeight="700">{i + 1}</text>
        </g>
      ))}
    </svg>
  );
}

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-16 scroll-mt-6">
      <div className="text-xs font-semibold uppercase tracking-widest text-teal-400">{eyebrow}</div>
      <h2 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-white">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

const JOURNEYS = [
  {
    who: 'The club (GM, board, tennis chair)',
    steps: [
      'Gets a short, personal note only when real directors have already said yes to their role.',
      `Clicks through, accepts plain-English terms: ${FEE} on hire, nothing up front.`,
      'Completes the intake: priorities, pay, program scope, leadership expectations.',
      'Reviews a ranked shortlist in a private portal: résumés, AI fit, strengths, gaps, interview questions.',
      'Interviews, decides, marks the hire. Gets a 90-day replacement guarantee.',
    ],
  },
  {
    who: 'The candidate (director)',
    steps: [
      'Joins free through the founding network or the job board. Résumé stays private.',
      'Hears privately about roles that are a real step up, close enough to take.',
      'Clicks "present me to this club" for one club and one role. Nothing is shared before that.',
      'Never has current pay shown to a club. Can withdraw or delete everything in one click.',
      'Invites colleagues with a private link, which grows the network.',
    ],
  },
  {
    who: 'Darrin & Kevin',
    steps: [
      'Monday and Tuesday run themselves: new jobs, 990 matches, contacts, ranked candidates.',
      'One approval queue: personal notes to directors and every email to a GM or board.',
      'A funnel per job: ranked → contacted → confirmed → pitched → claimed.',
      'Personal help where it matters: the first call, interviews, finalists.',
      'A placement record for every hire (terms, consent, dates) so attribution is never disputed.',
    ],
  },
];

const SCREENS = [
  { href: '/connect/process', title: 'How we hire', body: 'The client-facing six steps, the fee and the full terms.' },
  { href: '/connect/jobs', title: 'Job board', body: 'ClubMode searches on top, public listings below, clearly labeled.' },
  { href: '/connect/founding', title: 'Founding director network', body: 'The invite page for directors we know personally.' },
  { href: '/connect/clubs', title: 'Club portal', body: 'Post an opening and run the pipeline (sign-in required).' },
  { href: '/connect/candidate', title: 'Candidate profile', body: 'Résumé, experience, open-to-work, applications (sign-in required).' },
  { href: '/connect/privacy', title: 'Privacy', body: 'What we collect, how AI is used, who sees what.' },
];

const GUARDRAILS = [
  `No club email until ${MIN_CONFIRMED_FOR_PITCH}+ candidates have confirmed interest, re-checked at send.`,
  'Every email to a GM, board member or new director is approved by Darrin or Kevin.',
  'Follow-ups: at most 3, at least 7 days apart, each bringing something new. Never "just checking in."',
  'Candidate emails are honest: if a club posted publicly and isn’t working with us, we say so.',
  'A candidate is shared with one club only after they say yes to that club, for that role.',
  'Clubs never see a candidate’s current pay. Contacts are saved only if printed on the club’s own site.',
  'Fees apply to director-level roles only. Assistant and teaching jobs stay on the board, free.',
  'No LinkedIn, Indeed or Glassdoor scraping. robots.txt respected. We link to postings, never copy them.',
];

export default async function RecruitingDemoPage() {
  const nums = await liveNumbers();
  const list = emails();

  return (
    <div className="max-w-6xl mx-auto px-4 py-12">
      <div className="text-xs font-semibold uppercase tracking-widest text-teal-400">ClubMode Recruiting · product tour</div>
      <h1 className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight text-white">An AI-native recruiting flywheel for club racquets</h1>
      <p className="mt-4 max-w-3xl text-lg text-slate-300">
        Clubs pay a flat {FEE} only when they hire someone we introduced. AI does the finding, ranking and paperwork every week.
        People handle the moments that matter. This page shows the whole thing: the loop, every email, and what each side sees.
      </p>
      <nav className="mt-6 flex flex-wrap gap-2 text-sm">
        {[['#flywheel', 'The flywheel'], ['#journeys', 'Three journeys'], ['#emails', 'Every email'], ['#screens', 'Live screens'], ['#guardrails', 'Guardrails'], ['#model', 'The model']].map(([h, l]) => (
          <a key={h} href={h} className="rounded-full border border-white/15 px-3 py-1 text-slate-200 hover:border-teal-400 hover:text-white">{l}</a>
        ))}
      </nav>

      {nums && (
        <div className="mt-8 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            [nums.jobs, 'open jobs found'],
            [nums.dirs, 'director / GM level'],
            [nums.contacts, 'club decision-makers'],
            [nums.emails, 'with a published email'],
            [nums.cands, 'directors in network'],
          ].map(([n, l]) => (
            <div key={String(l)} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-2xl font-bold text-white">{n}</div>
              <div className="text-xs text-slate-400">{l}</div>
            </div>
          ))}
          <p className="col-span-2 sm:col-span-5 text-xs text-slate-500">Live from the system, refreshed hourly. Week one: the jobs side is running; the candidate network is the next push.</p>
        </div>
      )}

      <Section id="flywheel" eyebrow="1 · The loop" title="Six stations, running every week">
        <div className="grid lg:grid-cols-[420px_1fr] gap-8 items-center">
          <Flywheel />
          <ol className="grid sm:grid-cols-2 gap-3">
            {STATIONS.map((s) => (
              <li key={s.n} className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">{s.n}</span>
                  <span className="font-semibold text-white">{s.title}</span>
                  <span className="ml-auto text-[11px] rounded-full bg-teal-400/10 px-2 py-0.5 text-teal-200">{s.day}</span>
                </div>
                <p className="mt-2 text-sm text-slate-300">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <div className="mt-6 rounded-xl border border-teal-400/30 bg-teal-400/10 p-4 text-sm text-teal-100">
          <strong>Why it compounds:</strong> every job brings new directors into the network, every placed director refers colleagues,
          and every club that hires once comes back. The AI cost per job is cents; the fee per hire is {FEE}.
        </div>
        <div className="mt-6 grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold text-white">Example: the targeting logic</div>
            <p className="mt-1 text-slate-300">
              A club pays $250k. We look for directors earning roughly 60–90% of that (a real step up), close enough to move.
              Radius grows with pay: 50 mi under $120k, 100 mi under $180k, 250 mi under $300k, national above.
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold text-white">Where jobs come from</div>
            <p className="mt-1 text-slate-300">RSPA, PTR, KK&amp;W, MyCoachingTree and Hospitality Online today. Each matched to the club’s Form 990 for pay and size.</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold text-white">Where candidates come from</div>
            <p className="mt-1 text-slate-300">The founding network, the job board, colleague referrals, and directors identified from 990 filings (personal notes, approved by us).</p>
          </div>
        </div>
      </Section>

      <Section id="journeys" eyebrow="2 · 360°" title="What each side experiences">
        <div className="grid md:grid-cols-3 gap-4">
          {JOURNEYS.map((j) => (
            <div key={j.who} className="rounded-xl border border-white/10 bg-white/5 p-5">
              <div className="flex items-center gap-2 font-semibold text-white"><UserCheck className="h-4 w-4 text-teal-400" /> {j.who}</div>
              <ol className="mt-3 space-y-2 text-sm text-slate-300">
                {j.steps.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-teal-400 font-semibold">{i + 1}</span><span>{s}</span></li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>

      <Section id="emails" eyebrow="3 · Every email" title="Exactly what people receive">
        <p className="mb-5 max-w-3xl text-slate-300">
          These are generated by the same code that sends the real emails, filled with a fictional club (Lakeside Country Club) and
          fictional people. Links point to demo pages.
        </p>
        <div className="grid lg:grid-cols-2 gap-5">
          {list.map((e) => (
            <article key={e.key} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
              <div className="p-4 border-b border-white/10">
                <div className="flex flex-wrap items-center gap-2">
                  <Mail className="h-4 w-4 text-teal-400" />
                  <span className="font-semibold text-white">To: {e.who}</span>
                  <span className={`ml-auto text-[11px] rounded-full px-2 py-0.5 ${e.auto ? 'bg-sky-400/10 text-sky-200' : 'bg-amber-400/10 text-amber-200'}`}>
                    {e.auto ? 'Automatic' : 'Needs approval'}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-400"><strong className="text-slate-300">When:</strong> {e.when}</p>
                <p className="text-xs text-slate-400"><strong className="text-slate-300">Approval:</strong> {e.approval}</p>
              </div>
              <div className="bg-white p-5 text-slate-800">
                <div className="text-xs text-slate-500">From: ClubMode Recruiting</div>
                <div className="mb-3 font-semibold text-slate-900">{e.subject}</div>
                <div
                  className="text-sm leading-relaxed [&_p]:my-2 [&_a]:text-teal-700 [&_table]:w-full"
                  // Built by our own template functions from fixed sample data above.
                  dangerouslySetInnerHTML={{ __html: e.html }}
                />
              </div>
            </article>
          ))}
        </div>
      </Section>

      <Section id="screens" eyebrow="4 · Live" title="The screens clubs and candidates use">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SCREENS.map((s) => (
            <Link key={s.href} href={s.href} target="_blank" className="group rounded-xl border border-white/10 bg-white/5 p-4 hover:border-teal-400">
              <div className="flex items-center gap-2 font-semibold text-white">
                {s.title} <ExternalLink className="h-3.5 w-3.5 text-slate-400 group-hover:text-teal-300" />
              </div>
              <p className="mt-1 text-sm text-slate-300">{s.body}</p>
              <p className="mt-2 text-xs text-teal-400">clubmode.ai{s.href}</p>
            </Link>
          ))}
        </div>
        <p className="mt-4 text-sm text-slate-400">
          The client one-pager: <a href="/connect/recruiting-process.png" target="_blank" rel="noreferrer" className="text-teal-400 underline">download the image</a>.
        </p>
      </Section>

      <Section id="guardrails" eyebrow="5 · Trust" title="The guardrails built into the system">
        <ul className="grid sm:grid-cols-2 gap-3">
          {GUARDRAILS.map((g) => (
            <li key={g} className="flex gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <ShieldCheck className="h-4 w-4 shrink-0 text-teal-400 mt-0.5" /> {g}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="model" eyebrow="6 · The model" title={`${FEE} per hire. Nothing else.`}>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <div className="flex items-center gap-2 font-semibold text-white"><Lock className="h-4 w-4 text-teal-400" /> The terms a club accepts</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {PLACEMENT_TERMS.map((t) => (
                <li key={t} className="flex gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-teal-400 mt-0.5" /> {t}</li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-5">
            <div className="font-semibold text-white">How it compares</div>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400"><th className="py-1 font-medium"></th><th className="py-1 font-medium">Traditional search firm</th><th className="py-1 font-medium">ClubMode</th></tr>
              </thead>
              <tbody className="text-slate-300">
                {[
                  ['Upfront', 'Retainer', 'Nothing'],
                  ['Fee', 'Often a share of first-year pay', `Flat ${FEE}`],
                  ['If no hire', 'You still pay', 'You pay nothing'],
                  ['Candidate pool', 'Their rolodex', 'A growing opted-in network + every 990 director'],
                  ['Speed', 'Weeks to months', 'Ranked shortlist the week you start'],
                ].map(([a, b, c]) => (
                  <tr key={a} className="border-t border-white/10"><td className="py-2 pr-2 text-slate-400">{a}</td><td className="py-2 pr-2">{b}</td><td className="py-2 text-white">{c}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/connect/process" className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 font-semibold text-white hover:bg-teal-500">
            See the client page <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href="/connect/jobs" className="inline-flex items-center gap-2 rounded-lg border border-white/20 px-5 py-3 font-semibold text-white hover:border-teal-400">
            See the job board
          </Link>
        </div>
      </Section>
    </div>
  );
}

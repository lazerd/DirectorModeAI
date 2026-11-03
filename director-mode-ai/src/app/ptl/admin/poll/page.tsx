/**
 * Pilot-poll results for the commissioner: who has answered, live tallies,
 * and the latest Claude-written pilot plan. Platform owner only; 404 otherwise.
 */

import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { PILOT_POLL_SLUG, tally, type PollAnswers } from '@/lib/ptl/pilotPoll';
import PollAnalysis from '@/components/ptl/PollAnalysis';

export const dynamic = 'force-dynamic';
export const metadata = { robots: { index: false, follow: false } };

export default async function PollAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isPlatformOwnerEmail(user.email)) notFound();

  const db = getSupabaseAdmin();
  const [{ data: rows }, { data: latest }] = await Promise.all([
    db
      .from('ptl_poll_responses')
      .select('name, email, answers, updated_at')
      .eq('poll_slug', PILOT_POLL_SLUG)
      .order('updated_at', { ascending: false }),
    db
      .from('ptl_poll_analyses')
      .select('analysis, response_count, created_at')
      .eq('poll_slug', PILOT_POLL_SLUG)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const responses = (rows ?? []) as { name: string; email: string; answers: PollAnswers; updated_at: string }[];
  const tallies = tally(responses);

  return (
    <div className="mx-auto max-w-4xl px-5 pb-24 pt-12">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">Commissioner</p>
      <h1 className="mt-3 text-4xl font-black tracking-tight">Pilot poll results</h1>
      <p className="mt-3 text-white/60">
        {responses.length} {responses.length === 1 ? 'response' : 'responses'}
        {responses.length > 0 && <>: {responses.map((r) => r.name).join(', ')}</>}
      </p>

      <PollAnalysis
        initial={(latest as any)?.analysis ?? null}
        initialCount={(latest as any)?.response_count ?? 0}
        initialAt={(latest as any)?.created_at ?? null}
        responseCount={responses.length}
      />

      <h2 className="mt-16 text-2xl font-black tracking-tight">Raw tallies</h2>
      <div className="mt-6 space-y-10">
        {tallies.map(({ q, counts, notes }) => (
          <section key={q.id}>
            <h3 className="font-bold text-white">{q.title}</h3>
            {counts.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {counts
                  .slice()
                  .sort((a, b) => b.count - a.count)
                  .map((c) => (
                    <li key={c.option} className="flex items-center gap-3 text-sm">
                      <span className="w-6 text-right font-semibold tabular-nums text-teal-300">{c.count}</span>
                      <span className="relative h-2 w-28 flex-none rounded-full bg-white/10">
                        <span
                          className="absolute inset-y-0 left-0 rounded-full bg-teal-400"
                          style={{ width: responses.length ? `${(c.count / responses.length) * 100}%` : 0 }}
                        />
                      </span>
                      <span className="text-white/75">{c.option}</span>
                    </li>
                  ))}
              </ul>
            )}
            {notes.length > 0 && (
              <ul className="mt-3 space-y-2 border-l border-white/10 pl-4 text-sm text-white/65">
                {notes.map((n, i) => (
                  <li key={i}>
                    <span className="font-semibold text-white/85">{n.name}:</span> {n.note}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

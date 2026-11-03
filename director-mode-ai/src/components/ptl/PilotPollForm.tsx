'use client';

/**
 * The pilot-planning poll form. One screen, every question, picks + a note.
 * Labels carry explicit text colours: globals.css has a bare `label` colour
 * meant for light surfaces that would vanish on this dark ground.
 */

import { useState } from 'react';
import { PtlCrest } from './Crest';
import type { PollAnswers, PollQuestion } from '@/lib/ptl/pilotPoll';

type Props = { title: string; intro: string; questions: PollQuestion[] };

export default function PilotPollForm({ title, intro, questions }: Props) {
  const [answers, setAnswers] = useState<PollAnswers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ updated: boolean } | null>(null);

  function toggle(q: PollQuestion, option: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? { picks: [], note: null };
      let picks: string[];
      if (q.kind === 'single') picks = cur.picks[0] === option ? [] : [option];
      else if (cur.picks.includes(option)) picks = cur.picks.filter((p) => p !== option);
      else if (q.maxPicks && cur.picks.length >= q.maxPicks) return prev;
      else picks = [...cur.picks, option];
      return { ...prev, [q.id]: { ...cur, picks } };
    });
  }

  function setNote(q: PollQuestion, note: string) {
    setAnswers((prev) => {
      const cur = prev[q.id] ?? { picks: [], note: null };
      return { ...prev, [q.id]: { ...cur, note } };
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/ptl/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.get('name'), email: form.get('email'), answers }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Something went wrong. Try again.');
        return;
      }
      setDone({ updated: !!body.updated });
      window.scrollTo({ top: 0 });
    } catch {
      setError('Lost the connection. Try that again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl px-5 py-24 text-center">
        <PtlCrest variant="crest" width={96} className="mx-auto" title={null} />
        <h1 className="mt-8 text-4xl font-black tracking-tight">
          {done.updated ? 'Answers updated.' : 'Thanks, you’re in.'}
        </h1>
        <p className="mt-4 text-white/65">
          Once everyone has answered, the responses get pulled into one pilot plan and sent back to
          the group. Want to change something? Submit again with the same email and it replaces
          your earlier answers.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl px-5 pb-24 pt-12">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
        5.0+ task force
      </p>
      <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">{title}</h1>
      <p className="mt-5 leading-relaxed text-white/70">{intro}</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-white/80">
          Your name
          <input
            name="name"
            required
            maxLength={80}
            className="mt-2 w-full rounded-sm border border-white/15 bg-white/[0.04] px-3 py-2.5 text-white placeholder:text-white/30 focus:border-teal-400 focus:outline-none"
          />
        </label>
        <label className="block text-sm font-semibold text-white/80">
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={160}
            className="mt-2 w-full rounded-sm border border-white/15 bg-white/[0.04] px-3 py-2.5 text-white placeholder:text-white/30 focus:border-teal-400 focus:outline-none"
          />
        </label>
      </div>

      <ol className="mt-10 space-y-10">
        {questions.map((q, i) => {
          const cur = answers[q.id];
          const full = !!q.maxPicks && (cur?.picks.length ?? 0) >= q.maxPicks;
          return (
            <li key={q.id} className="border-t border-white/10 pt-8">
              <h2 className="text-lg font-bold text-white">
                <span className="mr-2 text-white/35">{i + 1}.</span>
                {q.title}
              </h2>
              {q.help && <p className="mt-1 text-sm text-white/50">{q.help}</p>}

              {q.options.length > 0 && (
                <div className="mt-4 space-y-2">
                  {q.options.map((o) => {
                    const on = cur?.picks.includes(o) ?? false;
                    const disabled = !on && full;
                    return (
                      <button
                        type="button"
                        key={o}
                        onClick={() => toggle(q, o)}
                        disabled={disabled}
                        aria-pressed={on}
                        className={`flex w-full items-start gap-3 rounded-sm border px-4 py-3 text-left text-sm transition-colors ${
                          on
                            ? 'border-teal-400 bg-teal-400/10 text-white'
                            : disabled
                              ? 'cursor-not-allowed border-white/5 text-white/30'
                              : 'border-white/12 text-white/75 hover:border-white/30'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center border ${
                            q.kind === 'single' ? 'rounded-full' : 'rounded-[2px]'
                          } ${on ? 'border-teal-400 bg-teal-400' : 'border-white/35'}`}
                        >
                          {on && <span className="h-1.5 w-1.5 rounded-full bg-[#06231F]" />}
                        </span>
                        <span>{o}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <textarea
                rows={q.options.length ? 2 : 4}
                maxLength={2000}
                placeholder={q.notePrompt ?? 'Add a note (optional)'}
                value={cur?.note ?? ''}
                onChange={(e) => setNote(q, e.target.value)}
                className="mt-3 w-full rounded-sm border border-white/15 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-white/35 focus:border-teal-400 focus:outline-none"
              />
            </li>
          );
        })}
      </ol>

      {error && (
        <p className="mt-8 rounded-sm border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-10 w-full rounded-sm bg-teal-400 px-6 py-4 font-bold text-[#06231F] transition-colors hover:bg-teal-300 disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Submit my answers'}
      </button>
    </form>
  );
}

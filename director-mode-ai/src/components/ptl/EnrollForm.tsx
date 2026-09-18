'use client';

/**
 * Individual enrolment.
 *
 * The one thing this form has to overcome is a habit: everyone signing up has
 * spent years entering leagues *as a team*, and the first question in their head
 * is "who am I playing with?". So the page answers that before it asks for
 * anything — you enroll alone, captains draft the rosters — and the form itself
 * stays as short as a form can be.
 *
 * Only NTRP is required. UTR is looked up server-side from the name, and WTN is
 * optional, because a 5.0 who can't remember their WTN must not be stopped at
 * the door over a number we can live without.
 */

import { useState } from 'react';
import { PtlCrest } from './Crest';

type Props = {
  seasonSlug: string;
  seasonName: string;
  entryCents: number;
  isDemo: boolean;
};

const NTRP_OPTIONS = ['5.0', '5.5', '6.0', '6.5', '7.0'];

export default function EnrollForm({ seasonSlug, seasonName, entryCents, isDemo }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ composite: number; demo?: boolean; notice?: string } | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/ptl/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonSlug,
          name: form.get('name'),
          email: form.get('email'),
          phone: form.get('phone'),
          homeClub: form.get('homeClub'),
          ntrp: form.get('ntrp'),
          wtn: form.get('wtn') || null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error || 'Something went wrong. Try again.');
        return;
      }
      setDone({ composite: body.composite, demo: body.demo, notice: body.notice });
    } catch {
      setError('Lost the connection. Try that again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mx-auto max-w-xl px-5 py-20 text-center">
        <PtlCrest variant="crest" width={96} className="mx-auto" title={null} />
        <h1 className="mt-8 text-4xl font-black tracking-tight">You&rsquo;re in the pool.</h1>
        <p className="mt-4 text-white/65">
          Enrolled for <strong className="text-white">{seasonName}</strong>. You don&rsquo;t pick a
          team — captains draft the rosters, so every team starts balanced.
        </p>

        <div className="mt-8 rounded-sm border border-white/10 bg-white/[0.03] p-6 text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-400">
            What happens next
          </p>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-white/70">
            <li>
              <span className="mr-2 font-bold text-white/40">1</span>
              We confirm the field and set the draft date.
            </li>
            <li>
              <span className="mr-2 font-bold text-white/40">2</span>
              Captains draft. You&rsquo;ll hear the moment you&rsquo;re picked.
            </li>
            <li>
              <span className="mr-2 font-bold text-white/40">3</span>
              Your full season grid is published the same day — every date, up front.
            </li>
          </ol>
        </div>

        <p className="mt-6 text-sm text-white/45">
          Your draft rating came out at{' '}
          <span className="font-semibold tabular-nums text-white/75">{done.composite}</span>, blended
          from what you gave us and your UTR. If that looks wrong, tell the commissioner before the
          draft.
        </p>

        {done.notice && (
          <p className="mt-5 rounded-sm border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm text-amber-200/90">
            {done.notice}
          </p>
        )}

        <a
          href={`/ptl?season=${seasonSlug}`}
          className="mt-10 inline-block rounded-sm border border-white/25 px-6 py-3 font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
        >
          Back to the league
        </a>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-12">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-teal-400">
        {seasonName} · Enrolment
      </p>
      <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Enroll</h1>

      <div className="mt-6 rounded-sm border-l-2 border-teal-400/60 bg-white/[0.03] px-5 py-4">
        <p className="leading-relaxed text-white/75">
          <strong className="text-white">You enroll on your own</strong> — not with a team and not
          with a partner. Captains build the rosters at a live snake draft, which is what keeps every
          team balanced and stops anyone assembling a super-team.
        </p>
      </div>

      <p className="mt-6 text-sm text-white/50">
        Entry is{' '}
        <span className="font-semibold text-white/80">${(entryCents / 100).toFixed(0)}</span>,
        collected before the first night. Nothing is charged today.
      </p>

      <form onSubmit={submit} className="mt-10 space-y-6">
        <Field id="ptl-name" label="Full name" hint="As it appears on your UTR profile, if you have one.">
          <input
            id="ptl-name"
            name="name"
            required
            autoComplete="name"
            className={INPUT}
            placeholder="Alex Nakamura"
          />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="ptl-email" label="Email">
            <input
              id="ptl-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className={INPUT}
              placeholder="you@example.com"
            />
          </Field>
          <Field id="ptl-phone" label="Mobile" hint="For match-night changes only.">
            <input
              id="ptl-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              className={INPUT}
              placeholder="925-555-0134"
            />
          </Field>
        </div>

        <Field id="ptl-club" label="Home club" hint="Where you usually play. It doesn't affect the draft.">
          <input id="ptl-club" name="homeClub" className={INPUT} placeholder="Sleepy Hollow" />
        </Field>

        <div className="grid gap-6 sm:grid-cols-2">
          <Field id="ptl-ntrp" label="NTRP" hint="PTL is 5.0 and above.">
            <select id="ptl-ntrp" name="ntrp" required defaultValue="5.0" className={INPUT}>
              {NTRP_OPTIONS.map((v) => (
                <option key={v} value={v} className="bg-[#0B0F14]">
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field id="ptl-wtn" label="WTN" hint="Optional. Sharpens your draft rating if you know it.">
            <input
              id="ptl-wtn"
              name="wtn"
              type="number"
              step="0.1"
              min="1"
              max="40"
              className={INPUT}
              placeholder="8.4"
            />
          </Field>
        </div>

        {error && (
          <p className="rounded-sm border border-red-400/40 bg-red-400/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-sm bg-teal-400 px-8 py-4 text-base font-bold tracking-wide text-[#06231F] transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35 sm:w-auto"
        >
          {busy ? 'Enrolling…' : 'Enroll in the pool'}
        </button>

        <p className="text-xs leading-relaxed text-white/35">
          We look up your UTR from your name and blend it with what you&rsquo;ve given us to set your
          draft rating. Your contact details go to your captain once you&rsquo;re drafted, and
          nowhere else.
          {isDemo && ' This is a demo season — nothing here emails anyone.'}
        </p>
      </form>
    </div>
  );
}

const INPUT =
  'w-full rounded-sm border border-white/15 bg-white/[0.04] px-3.5 py-3 text-white placeholder:text-white/30 focus:border-teal-400/70 focus:outline-none';

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {/*
        text-white is load-bearing, not decoration. globals.css carries a bare
        `label { color: #334155 }` for the app's light surfaces, and on PTL's
        dark ground that renders the labels almost invisible. A class beats a
        bare element selector on specificity, so naming the colour here is the
        fix — see the same trap documented around `.input` in globals.css.
      */}
      <label htmlFor={id} className="block text-sm font-semibold text-white">
        {label}
      </label>
      {hint && <p className="mb-2 mt-0.5 text-xs text-white/40">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </div>
  );
}

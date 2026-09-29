'use client';

import { useState } from 'react';
import Link from 'next/link';
import { SMS_CONSENT_TEXT } from '@/lib/smsConsent';

const input =
  'w-full bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#D3FB52]/60';

export default function SmsOptInForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [team, setTeam] = useState('');
  // Carrier rule (30925): consent must start unchecked. Never initialise to true.
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/sms/opt-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, club_or_team: team, agreed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? 'Could not save. Please try again.');
      else setDone(true);
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-4 rounded-xl bg-[#D3FB52]/10 border border-[#D3FB52]/30 p-4 text-sm text-white/85">
        You&rsquo;re signed up. Your club or captain can now reach you by text. Reply STOP to any
        message to stop.
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <input className={input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      <input className={input} placeholder="Mobile number" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />
      <input className={input} placeholder="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <input className={input} placeholder="Club or team (optional), e.g. Sleepy Hollow Fall B2/B3" value={team} onChange={(e) => setTeam(e.target.value)} />
      <label className="flex items-start gap-2.5 cursor-pointer pt-1">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded accent-[#D3FB52]"
        />
        <span className="text-[13px] leading-relaxed text-white/70">
          {SMS_CONSENT_TEXT} See our{' '}
          <Link href="/terms" className="underline hover:text-white">Terms</Link> and{' '}
          <Link href="/privacy" className="underline hover:text-white">Privacy Policy</Link>.
        </span>
      </label>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <button
        type="submit"
        disabled={busy || !agreed}
        className="w-full rounded-xl bg-[#D3FB52] text-[#001820] font-semibold py-3 text-sm disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Sign me up for texts'}
      </button>
    </form>
  );
}

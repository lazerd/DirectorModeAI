'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { DetailRows, Notice, PeopleList, dangerBtn, postJson, primaryBtn, secondaryBtn } from '@/components/partnerFinder/ui';
import { needsLabel } from '@/lib/partnerFinder/format';

type Props = {
  token: string;
  clubName: string;
  myFirstName: string;
  poster: string;
  title: string;
  rows: [string, string][];
  note: string | null;
  status: 'open' | 'full' | 'cancelled' | 'expired' | 'past';
  spotsLeft: number;
  imIn: boolean;
  saidNo: boolean;
  group: { name: string; note: string | null }[];
};

type Outcome = { ok: boolean; result: string; message: string; error?: string };

/** A friend from outside the club answering the poster's invite. */
export default function GuestClient(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'info' | 'bad'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function act(action: 'join' | 'decline' | 'leave') {
    setBusy(true);
    setNotice(null);
    const r = await postJson<Outcome>(`/api/play/guest/${p.token}`, { action });
    setBusy(false);
    setConfirming(false);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    setNotice({ tone: r.ok || r.result === 'already_in' ? 'good' : 'info', text: r.message });
    router.refresh();
  }

  const closedText =
    p.status === 'cancelled'
      ? 'Sorry, this game was cancelled.'
      : p.status === 'past' || p.status === 'expired'
        ? 'This game has already started.'
        : null;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <p className="text-lg text-slate-600">{p.clubName}</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight">{p.title}</h1>
          {!p.imIn && p.status === 'open' && (
            <p className="mt-2 text-xl text-slate-700">
              Hi {p.myFirstName}, {p.poster} invited you. This game {needsLabel(p.spotsLeft)}.
            </p>
          )}
        </header>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <DetailRows rows={p.rows} />
          {p.note && <p className="mt-4 border-l-4 border-emerald-600 pl-4 text-lg italic text-slate-700">&ldquo;{p.note}&rdquo;</p>}
        </section>

        {!p.imIn && !(notice && notice.tone !== 'bad') && (
          closedText ? (
            <Notice tone="info">{closedText}</Notice>
          ) : p.status === 'full' ? (
            <Notice tone="info">This game is full now. Thanks for being up for it!</Notice>
          ) : (
            <div className="space-y-3">
              <button onClick={() => act('join')} disabled={busy} className={`${primaryBtn} w-full text-2xl`}>
                {busy ? 'One moment…' : "Yes, I'm in"}
              </button>
              {!p.saidNo && (
                <button onClick={() => act('decline')} disabled={busy} className={`${secondaryBtn} w-full text-xl`}>
                  No thanks
                </button>
              )}
              <p className="text-center text-lg text-slate-600">First to tap gets the spot.</p>
            </div>
          )
        )}

        {p.group.length > 0 && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-2xl font-bold">{p.status === 'full' ? "Who's playing" : 'In so far'}</h2>
            <div className="mt-4">
              <PeopleList people={p.group} />
            </div>
          </section>
        )}

        {p.imIn && !closedText && (
          confirming ? (
            <div className="space-y-3 rounded-3xl border-2 border-rose-200 bg-white p-6">
              <p className="text-xl font-semibold">Give up your spot?</p>
              <p className="text-lg text-slate-600">We&rsquo;ll tell {p.poster}, and the spot opens for someone else.</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={() => act('leave')} disabled={busy} className={`${dangerBtn} flex-1`}>
                  Yes, I can&rsquo;t make it
                </button>
                <button onClick={() => setConfirming(false)} className={`${secondaryBtn} flex-1`}>
                  Keep my spot
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming(true)} className={`${secondaryBtn} w-full`}>
              I can&rsquo;t make it
            </button>
          )
        )}
      </div>
    </main>
  );
}

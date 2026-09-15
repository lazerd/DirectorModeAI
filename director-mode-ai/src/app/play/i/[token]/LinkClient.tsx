'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DetailRows,
  LevelPicker,
  Notice,
  PeopleList,
  dangerBtn,
  postJson,
  primaryBtn,
  secondaryBtn,
} from '@/components/partnerFinder/ui';
import { needsLabel } from '@/lib/partnerFinder/format';

type Props = {
  token: string;
  clubName: string;
  clubSlug: string;
  myFirstName: string;
  title: string;
  rows: [string, string][];
  note: string | null;
  status: 'open' | 'full' | 'cancelled' | 'expired' | 'past';
  spotsLeft: number;
  isPoster: boolean;
  imIn: boolean;
  group: { name: string; note: string | null; phone: string | null }[];
  myLevel: number | null;
};

type Outcome = { ok: boolean; result: string; message: string; error?: string };

export default function LinkClient(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'info' | 'bad'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<null | 'leave' | 'cancel'>(null);
  const [askLevel, setAskLevel] = useState(false);
  const [level, setLevel] = useState<number | null>(p.myLevel);

  async function act(action: 'join' | 'leave' | 'cancel') {
    setBusy(true);
    setNotice(null);
    const r = await postJson<Outcome>(`/api/play/link/${p.token}`, { action });
    setBusy(false);
    setConfirming(null);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    const good = r.ok || r.result === 'already_in';
    setNotice({ tone: good ? 'good' : 'info', text: r.message });
    if (action === 'join' && r.ok && p.myLevel == null) setAskLevel(true);
    router.refresh();
  }

  async function saveLevel(n: number | null) {
    if (n == null) return setAskLevel(false);
    setBusy(true);
    const r = await postJson<Outcome>(`/api/play/link/${p.token}`, { action: 'level', ntrp: n });
    setBusy(false);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    setLevel(n);
    setAskLevel(false);
    setNotice({ tone: 'good', text: `Thanks. We'll send you games for ${n.toFixed(1)} players.` });
  }

  const closedText =
    p.status === 'cancelled'
      ? 'This game was cancelled.'
      : p.status === 'past' || p.status === 'expired'
        ? 'This game has already started.'
        : null;

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-900">
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <p className="text-lg text-slate-600">{p.clubName}</p>
          <h1 className="mt-1 text-3xl font-bold leading-tight">
            {p.isPoster ? 'Your game: ' : ''}
            {p.title}
          </h1>
          {!p.isPoster && !p.imIn && p.status === 'open' && (
            <p className="mt-2 text-xl text-slate-700">
              Hi {p.myFirstName}, this game {needsLabel(p.spotsLeft)}.
            </p>
          )}
        </header>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <DetailRows rows={p.rows} />
          {p.note && <p className="mt-4 border-l-4 border-emerald-600 pl-4 text-lg italic text-slate-700">&ldquo;{p.note}&rdquo;</p>}
        </section>

        {/* Someone who was invited and has not joined */}
        {/* Hidden once a tap has said what happened, so the answer is not shown twice. */}
        {!p.isPoster && !p.imIn && !(notice && notice.tone !== 'bad') && (
          <>
            {closedText ? (
              <Notice tone="info">{closedText}</Notice>
            ) : p.status === 'full' ? (
              <Notice tone="info">This game just filled. We&rsquo;ll tell you about the next one.</Notice>
            ) : (
              <div className="space-y-3">
                <button onClick={() => act('join')} disabled={busy} className={`${primaryBtn} w-full text-2xl`}>
                  {busy ? 'One moment…' : "I'm in"}
                </button>
                <p className="text-center text-lg text-slate-600">First to tap gets the spot.</p>
              </div>
            )}
          </>
        )}

        {/* In the game, or posted it */}
        {(p.isPoster || p.imIn) && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-2xl font-bold">
              {p.status === 'full' ? "Who's playing" : p.status === 'cancelled' ? 'Was playing' : 'In so far'}
            </h2>
            {p.status === 'open' && (
              <p className="mt-1 text-lg text-slate-600">Still {needsLabel(p.spotsLeft)}.</p>
            )}
            <div className="mt-4">
              <PeopleList people={p.group} />
            </div>
          </section>
        )}

        {askLevel && (
          <section className="rounded-3xl border-2 border-emerald-300 bg-white p-6">
            <h2 className="text-2xl font-bold">One quick question</h2>
            <p className="mt-1 text-lg text-slate-700">What&rsquo;s your level? We use it to send you games that suit you.</p>
            <div className="mt-4">
              <LevelPicker value={level} onPick={saveLevel} busy={busy} allowNotSure />
            </div>
          </section>
        )}

        {p.imIn && !closedText && (
          confirming === 'leave' ? (
            <div className="space-y-3 rounded-3xl border-2 border-rose-200 bg-white p-6">
              <p className="text-xl font-semibold">Give up your spot?</p>
              <p className="text-lg text-slate-600">We&rsquo;ll tell the person who posted the game, and the spot opens for someone else.</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={() => act('leave')} disabled={busy} className={`${dangerBtn} flex-1`}>
                  Yes, I can&rsquo;t make it
                </button>
                <button onClick={() => setConfirming(null)} className={`${secondaryBtn} flex-1`}>
                  Keep my spot
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming('leave')} className={`${secondaryBtn} w-full`}>
              I can&rsquo;t make it
            </button>
          )
        )}

        {p.isPoster && !closedText && (
          confirming === 'cancel' ? (
            <div className="space-y-3 rounded-3xl border-2 border-rose-200 bg-white p-6">
              <p className="text-xl font-semibold">Cancel this game?</p>
              <p className="text-lg text-slate-600">Everyone who joined gets an email saying it&rsquo;s off.</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={() => act('cancel')} disabled={busy} className={`${dangerBtn} flex-1`}>
                  Yes, cancel it
                </button>
                <button onClick={() => setConfirming(null)} className={`${secondaryBtn} flex-1`}>
                  Keep the game
                </button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirming('cancel')} className={`${secondaryBtn} w-full`}>
              Cancel this game
            </button>
          )
        )}

        <p className="pt-2 text-center text-lg">
          <Link href={`/c/${p.clubSlug}/play`} className="text-emerald-800 underline">
            See all games at {p.clubName}
          </Link>
        </p>
      </div>
    </main>
  );
}

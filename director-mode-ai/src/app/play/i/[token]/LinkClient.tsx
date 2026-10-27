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
import { levelValue, type LevelScale } from '@/lib/levels';

type Props = {
  token: string;
  clubName: string;
  clubSlug: string;
  myFirstName: string;
  /**
   * Whose link this is, in full. Two people can share one inbox (Pat and Sam
   * Kim), so the page always says who it is answering for — joined or not.
   */
  myName: string;
  /** Which email button brought them here. It only highlights; it never acts. */
  emailAnswer: 'yes' | 'no' | null;
  title: string;
  rows: [string, string][];
  note: string | null;
  status: 'open' | 'full' | 'cancelled' | 'expired' | 'past';
  spotsLeft: number;
  isPoster: boolean;
  imIn: boolean;
  /** 1-based place in line, or 0 when not waiting. */
  myWaitPlace: number;
  waitingCount: number;
  group: { name: string; note: string | null; phone: string | null; seatId: string | null }[];
  /** The host already sent their one reminder to people who never answered. */
  nudged: boolean;
  /** Members the host may seat by hand. Empty for everyone but the host. */
  addable: { id: string; name: string }[];
  /** Who is in line, in tap order. Empty for everyone but the host. */
  line: { id: string; name: string }[];
  /** The poster's own outside friends and their answer for this game. Empty for everyone else. */
  friends: { id: string; name: string; email: string; status: 'invited' | 'in' | 'no' | 'left' | 'removed' | null }[];
  myLevel: number | null;
  /** What this club calls a level — see lib/levels.ts. */
  scale: LevelScale;
};

type Outcome = { ok: boolean; result: string; message: string; error?: string };

export default function LinkClient(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'good' | 'info' | 'bad'; text: string } | null>(null);
  const [confirming, setConfirming] = useState<null | 'leave' | 'cancel'>(null);
  const [askLevel, setAskLevel] = useState(false);
  const [level, setLevel] = useState<number | null>(p.myLevel);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState('');
  const [guest, setGuest] = useState('');
  const [writing, setWriting] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [fName, setFName] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [invitePreview, setInvitePreview] = useState<null | { recipients: string[]; subject: string; skipped: string[] }>(null);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<null | { recipients: string[]; subject: string; noEmail: string[] }>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [nudgePreview, setNudgePreview] = useState<null | { members: string[]; friends: string[] }>(null);

  async function act(action: 'join' | 'decline' | 'leave' | 'cancel') {
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

  /*
   * The host seating someone who already said yes — on court, by text, in the
   * parking lot. A member is picked from the club's list; anyone else goes in
   * as a guest by name and is never written to PlayerVault.
   */
  async function addPlayer(fromLine?: string) {
    const personId = fromLine || pick;
    if (!personId && !guest.trim()) {
      return setNotice({ tone: 'bad', text: 'Pick a member or type a guest name.' });
    }
    setBusy(true);
    setNotice(null);
    // Seating someone from the line is the same pf_host_add: it turns their
    // 'wait' row into a seat.
    const r = await postJson<Outcome>(`/api/play/link/${p.token}`, {
      action: 'add',
      personId: personId || null,
      guestName: personId ? '' : guest.trim(),
    });
    setBusy(false);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    setNotice({ tone: r.ok ? 'good' : 'info', text: r.message });
    if (r.ok) {
      setPick('');
      setGuest('');
      setAdding(false);
    }
    router.refresh();
  }

  /*
   * The host taking someone off — they cancelled by text, or a guest isn't
   * coming. Two taps: the name's Remove, then "Yes, take them off".
   */
  async function removePlayer(seatId: string) {
    setBusy(true);
    setNotice(null);
    const r = await postJson<Outcome>(`/api/play/link/${p.token}`, { action: 'remove', seatId });
    setBusy(false);
    setRemoving(null);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    setNotice({ tone: r.ok ? 'good' : 'info', text: r.message });
    router.refresh();
  }

  /*
   * One more invitation to everyone who never answered. Preview first (same
   * server code), then send. Once per game.
   */
  async function nudge(send: boolean) {
    setBusy(true);
    setNotice(null);
    const r = await postJson<Outcome & { members?: string[]; friends?: string[] }>(`/api/play/link/${p.token}`, {
      action: 'nudge',
      send,
    });
    setBusy(false);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    if (!r.ok) {
      setNudgePreview(null);
      return setNotice({ tone: 'info', text: r.message });
    }
    if (!send) return setNudgePreview({ members: r.members ?? [], friends: r.friends ?? [] });
    setNudgePreview(null);
    setNotice({ tone: 'good', text: r.message });
    router.refresh();
  }

  /*
   * The host's note to everyone signed up. First press shows exactly who it
   * goes to (built by the same server code that sends); only the second sends.
   */
  async function sendMessage(send: boolean) {
    if (!msg.trim()) return setNotice({ tone: 'bad', text: 'Type a message first.' });
    setBusy(true);
    setNotice(null);
    const r = await postJson<Outcome & { recipients?: string[]; subject?: string; noEmail?: string[] }>(
      `/api/play/link/${p.token}`,
      { action: 'message', text: msg, send },
    );
    setBusy(false);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    if (!r.ok) {
      setPreview(null);
      return setNotice({ tone: 'info', text: r.message });
    }
    if (!send) {
      return setPreview({ recipients: r.recipients ?? [], subject: r.subject ?? '', noEmail: r.noEmail ?? [] });
    }
    setNotice({ tone: 'good', text: r.message });
    setPreview(null);
    setMsg('');
    setWriting(false);
  }

  /*
   * The poster's own friends from outside the club. Saved to THEIR list only,
   * never the club's PlayerVault. Inviting is preview-then-send, like the note.
   */
  async function saveFriend() {
    setBusy(true);
    setNotice(null);
    const r = await postJson<Outcome & { contact?: { id: string } }>(`/api/play/link/${p.token}`, {
      action: 'guest_save',
      name: fName,
      email: fEmail,
    });
    setBusy(false);
    if (r.error || !r.ok) return setNotice({ tone: 'bad', text: r.error || r.message });
    if (r.contact) setPicked((cur) => (cur.includes(r.contact!.id) ? cur : [...cur, r.contact!.id]));
    setFName('');
    setFEmail('');
    setInvitePreview(null);
    router.refresh();
  }

  async function forgetFriend(id: string) {
    await postJson<Outcome>(`/api/play/link/${p.token}`, { action: 'guest_forget', contactId: id });
    setPicked((cur) => cur.filter((x) => x !== id));
    setInvitePreview(null);
    router.refresh();
  }

  async function inviteFriends(send: boolean) {
    setBusy(true);
    setNotice(null);
    const r = await postJson<Outcome & { recipients?: string[]; subject?: string; skipped?: string[] }>(
      `/api/play/link/${p.token}`,
      { action: 'guest_invite', contactIds: picked, send },
    );
    setBusy(false);
    if (r.error) return setNotice({ tone: 'bad', text: r.error });
    if (!r.ok) {
      setInvitePreview(null);
      return setNotice({ tone: 'info', text: r.message });
    }
    if (!send) return setInvitePreview({ recipients: r.recipients ?? [], subject: r.subject ?? '', skipped: r.skipped ?? [] });
    setNotice({ tone: 'good', text: r.message });
    setInvitePreview(null);
    setPicked([]);
    setInviting(false);
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
    setNotice({ tone: 'good', text: `Thanks. We'll send you games for ${levelValue(p.scale, n)} players.` });
  }

  const closedText =
    p.status === 'cancelled'
      ? 'Sorry, this game was cancelled.'
      : p.status === 'past' || p.status === 'expired'
        ? 'This game has already started.'
        : null;

  /* The email button they tapped, ringed so it is the obvious next tap. */
  const lit = (answer: 'yes' | 'no') => (p.emailAnswer === answer ? ' ring-4 ring-amber-300 ring-offset-2' : '');
  const spotOpen = p.status === 'open' && p.spotsLeft > 0;

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
          {!p.isPoster && p.imIn && !closedText && (
            <p className="mt-2 text-xl font-semibold text-emerald-800">You&rsquo;re in, {p.myFirstName}.</p>
          )}
          <p className="mt-2 text-lg text-slate-600">
            {p.isPoster ? 'This page is for' : 'Answering for'} <span className="font-semibold text-slate-800">{p.myName}</span>
          </p>
        </header>

        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          <DetailRows rows={p.rows} />
          {p.note && <p className="mt-4 border-l-4 border-emerald-600 pl-4 text-lg italic text-slate-700">&ldquo;{p.note}&rdquo;</p>}
        </section>

        {/* Already in line for a full game */}
        {p.myWaitPlace > 0 && !p.imIn && !notice && !spotOpen && !closedText && (
          <Notice tone="info">
            You&rsquo;re {p.myWaitPlace === 1 ? 'first' : `number ${p.myWaitPlace}`} in line for this game. We&rsquo;ll
            email you the moment a spot opens.
          </Notice>
        )}

        {/*
          In line, and a spot is open. Nobody is moved in automatically — the
          whole line was emailed and the first tap takes it — so this is the
          tap. Before 2026-10-27 the page said "we'll email you" with only a
          "Take me off the list" button, while the email's "Yes, I'll take it"
          landed here and did nothing.
        */}
        {p.myWaitPlace > 0 && !p.imIn && spotOpen && !closedText && !(notice && notice.tone !== 'bad') && (
          <div className="space-y-3">
            <p className="text-xl text-slate-700">A spot just opened, and you&rsquo;re in line for it. Still want it?</p>
            <button onClick={() => act('join')} disabled={busy} className={`${primaryBtn} w-full text-2xl${lit('yes')}`}>
              {busy ? 'One moment…' : 'Take the spot'}
            </button>
            <p className="text-center text-lg text-slate-600">First to tap gets it.</p>
          </div>
        )}

        {/* Someone who was invited and has not joined */}
        {/* Hidden once a tap has said what happened, so the answer is not shown twice. */}
        {!p.isPoster && !p.imIn && p.myWaitPlace === 0 && !(notice && notice.tone !== 'bad') && (
          <>
            {closedText ? (
              <Notice tone="info">{closedText}</Notice>
            ) : p.status === 'full' ? (
              /* Full is no longer a closed door: the answer becomes a place in line. */
              <div className="space-y-3">
                <p className="text-xl text-slate-700">
                  This game is full{p.waitingCount > 0 ? `, and ${p.waitingCount} ${p.waitingCount === 1 ? 'person is' : 'people are'} in line` : ''}.
                  Want the spot if someone drops out?
                </p>
                <button onClick={() => act('join')} disabled={busy} className={`${primaryBtn} w-full text-2xl${lit('yes')}`}>
                  {busy ? 'One moment…' : 'Put me in line'}
                </button>
                <button onClick={() => act('decline')} disabled={busy} className={`${secondaryBtn} w-full text-xl${lit('no')}`}>
                  No, not this time
                </button>
              </div>
            ) : (
              /* Two answers, one tap each. A "no" is not a dead end: the same
                 email still works if they change their mind. */
              <div className="space-y-3">
                <button onClick={() => act('join')} disabled={busy} className={`${primaryBtn} w-full text-2xl${lit('yes')}`}>
                  {busy ? 'One moment…' : "Yes, I'm in"}
                </button>
                <button onClick={() => act('decline')} disabled={busy} className={`${secondaryBtn} w-full text-xl${lit('no')}`}>
                  No, not this time
                </button>
                <p className="text-center text-lg text-slate-600">First to tap gets the spot.</p>
              </div>
            )}
          </>
        )}

        {/* Who is playing — shown to everyone who got the email, not just the group */}
        {p.group.length > 0 && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-2xl font-bold">
              {p.status === 'full' ? "Who's playing" : p.status === 'cancelled' ? 'Was playing' : 'In so far'}
            </h2>
            {p.status === 'open' && (
              <p className="mt-1 text-lg text-slate-600">Still {needsLabel(p.spotsLeft)}.</p>
            )}
            <div className="mt-4">
              {p.isPoster && !closedText ? (
                <ul className="space-y-3 text-lg">
                  {p.group.map((m, i) => (
                    <li key={`${m.name}-${i}`} className="space-y-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold">{m.name}</span>
                        {m.note && <span className="text-slate-500">{m.note}</span>}
                        {m.phone && (
                          <a href={`tel:${m.phone.replace(/[^0-9+]/g, '')}`} className="text-emerald-800 underline">
                            {m.phone}
                          </a>
                        )}
                        {m.seatId && removing !== m.seatId && (
                          <button onClick={() => setRemoving(m.seatId)} className="ml-auto text-base text-rose-700 underline">
                            Remove
                          </button>
                        )}
                      </div>
                      {m.seatId && removing === m.seatId && (
                        <div className="flex flex-col gap-2 rounded-2xl bg-rose-50 p-3 sm:flex-row">
                          <button onClick={() => removePlayer(m.seatId!)} disabled={busy} className={`${dangerBtn} flex-1`}>
                            {busy ? 'One moment…' : `Yes, take ${m.name} off`}
                          </button>
                          <button onClick={() => setRemoving(null)} className={`${secondaryBtn} flex-1`}>
                            Keep them
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <PeopleList people={p.group} />
              )}
            </div>
          </section>
        )}

        {askLevel && (
          <section className="rounded-3xl border-2 border-emerald-300 bg-white p-6">
            <h2 className="text-2xl font-bold">One quick question</h2>
            <p className="mt-1 text-lg text-slate-700">What&rsquo;s your level? We use it to send you games that suit you.</p>
            <div className="mt-4">
              <LevelPicker scale={p.scale} value={level} onPick={saveLevel} busy={busy} allowNotSure />
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

        {p.myWaitPlace > 0 && !p.imIn && !closedText && (
          <button onClick={() => act('leave')} disabled={busy} className={`${secondaryBtn} w-full${lit('no')}`}>
            Take me off the list
          </button>
        )}

        {/* The host sees the line, and can seat someone from it when a spot is open. */}
        {p.isPoster && !closedText && p.line.length > 0 && (
          <section className="rounded-3xl border border-slate-200 bg-white p-6">
            <h2 className="text-2xl font-bold">In line</h2>
            <p className="mt-1 text-lg text-slate-600">
              {spotOpen
                ? 'A spot is open. Everyone in line was emailed, and the first to tap takes it. Or seat someone yourself.'
                : 'If a spot opens, everyone in line is emailed and the first to tap takes it.'}
            </p>
            <ol className="mt-4 space-y-3 text-lg">
              {p.line.map((w, i) => (
                <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-slate-500">{i + 1}.</span>
                  <span className="font-semibold">{w.name}</span>
                  {spotOpen && (
                    <button onClick={() => addPlayer(w.id)} disabled={busy} className="ml-auto text-base font-semibold text-emerald-800 underline">
                      Seat
                    </button>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* The host can seat someone who said yes without waiting for a tap. */}
        {p.isPoster && !closedText && p.status === 'open' && (
          adding ? (
            <section className="space-y-3 rounded-3xl border-2 border-emerald-300 bg-white p-6">
              <h2 className="text-2xl font-bold">Who said yes?</h2>
              <p className="text-lg text-slate-600">
                Put someone in who told you they&rsquo;re playing. They don&rsquo;t need to tap anything.
              </p>
              {p.addable.length > 0 && (
                <label className="block">
                  <span className="text-lg font-semibold text-slate-700">A member</span>
                  <select
                    value={pick}
                    onChange={(e) => {
                      setPick(e.target.value);
                      if (e.target.value) setGuest('');
                    }}
                    className="mt-1 w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-xl"
                  >
                    <option value="">Choose someone…</option>
                    {p.addable.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block">
                <span className="text-lg font-semibold text-slate-700">
                  {p.addable.length > 0 ? 'Or a guest' : 'A guest'}
                </span>
                <input
                  value={guest}
                  onChange={(e) => {
                    setGuest(e.target.value);
                    if (e.target.value) setPick('');
                  }}
                  placeholder="Their name"
                  maxLength={60}
                  className="mt-1 w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-xl"
                />
                <span className="mt-1 block text-base text-slate-500">
                  Someone visiting. We just note the name for the group — no emails, and they aren&rsquo;t
                  added to the club.
                </span>
              </label>
              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={() => addPlayer()} disabled={busy} className={`${primaryBtn} flex-1`}>
                  {busy ? 'One moment…' : 'Add them'}
                </button>
                <button onClick={() => { setAdding(false); setPick(''); setGuest(''); }} className={`${secondaryBtn} flex-1`}>
                  Never mind
                </button>
              </div>
            </section>
          ) : (
            <button onClick={() => setAdding(true)} className={`${secondaryBtn} w-full`}>
              Add someone who said yes
            </button>
          )
        )}

        {/* The poster's own friends from outside the club, e.g. from their other club. */}
        {p.isPoster && !closedText && p.status === 'open' && (
          inviting ? (
            <section className="space-y-4 rounded-3xl border-2 border-emerald-300 bg-white p-6">
              <h2 className="text-2xl font-bold">Invite your own friends</h2>
              <p className="text-lg text-slate-600">
                Friends from outside the club. They get an email from you with an &ldquo;I&rsquo;m in&rdquo; button, and the
                first to tap gets the spot. Your list is private to you, and they aren&rsquo;t added to the club.
              </p>
              {p.friends.length > 0 && (
                <ul className="space-y-2">
                  {p.friends.map((f) => {
                    const settled = f.status === 'in' || f.status === 'no';
                    const tag =
                      f.status === 'in' ? 'playing' : f.status === 'no' ? 'said no' : f.status === 'invited' ? 'invited' : f.status === 'left' ? 'dropped out' : f.status === 'removed' ? 'taken off' : null;
                    return (
                      <li key={f.id} className="flex items-center gap-3 text-lg">
                        <input
                          type="checkbox"
                          className="h-6 w-6"
                          disabled={settled}
                          checked={picked.includes(f.id)}
                          onChange={(e) => {
                            setInvitePreview(null);
                            setPicked((cur) => (e.target.checked ? [...cur, f.id] : cur.filter((x) => x !== f.id)));
                          }}
                          aria-label={`Invite ${f.name}`}
                        />
                        <span className="font-semibold">{f.name}</span>
                        <span className="truncate text-slate-500">{f.email}</span>
                        {tag && <span className="rounded-full bg-slate-100 px-2 text-base text-slate-700">{tag}</span>}
                        <button onClick={() => forgetFriend(f.id)} className="ml-auto text-base text-slate-500 underline">
                          remove
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="space-y-2 rounded-2xl bg-slate-50 p-4">
                <p className="text-lg font-semibold text-slate-700">Add a friend</p>
                <input
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  placeholder="Their name"
                  maxLength={60}
                  className="w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-xl"
                />
                <input
                  value={fEmail}
                  onChange={(e) => setFEmail(e.target.value)}
                  placeholder="Their email"
                  type="email"
                  inputMode="email"
                  className="w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-xl"
                />
                <button onClick={saveFriend} disabled={busy || !fName.trim() || !fEmail.trim()} className={`${secondaryBtn} w-full`}>
                  Save to my list
                </button>
              </div>
              {invitePreview ? (
                <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                  <p className="text-lg">
                    <span className="font-semibold">This goes to:</span> {invitePreview.recipients.join(', ')}
                  </p>
                  <p className="text-lg text-slate-600">
                    <span className="font-semibold">Subject:</span> {invitePreview.subject}
                  </p>
                  {invitePreview.skipped.length > 0 && (
                    <p className="text-base text-slate-500">Already answered, so not asked again: {invitePreview.skipped.join(', ')}</p>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button onClick={() => inviteFriends(true)} disabled={busy} className={`${primaryBtn} flex-1`}>
                      {busy ? 'Sending…' : 'Send invites'}
                    </button>
                    <button onClick={() => setInvitePreview(null)} className={`${secondaryBtn} flex-1`}>
                      Change
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button onClick={() => inviteFriends(false)} disabled={busy || picked.length === 0} className={`${primaryBtn} flex-1`}>
                    {busy ? 'One moment…' : picked.length ? `Next (${picked.length} ticked)` : 'Tick who to invite'}
                  </button>
                  <button onClick={() => { setInviting(false); setPicked([]); setInvitePreview(null); }} className={`${secondaryBtn} flex-1`}>
                    Never mind
                  </button>
                </div>
              )}
            </section>
          ) : (
            <button onClick={() => setInviting(true)} className={`${secondaryBtn} w-full`}>
              Invite your own friends
            </button>
          )
        )}

        {/* The host's one reminder to everyone who got the invitation and never answered. */}
        {p.isPoster && !closedText && p.status === 'open' && !p.nudged && (
          nudgePreview ? (
            <section className="space-y-3 rounded-3xl border-2 border-emerald-300 bg-white p-6">
              <h2 className="text-2xl font-bold">Remind people who haven&rsquo;t answered</h2>
              <p className="text-lg text-slate-600">
                They get the invitation again, saying you&rsquo;re still looking. You can do this once per game.
              </p>
              {nudgePreview.members.length > 0 && (
                <p className="text-lg">
                  <span className="font-semibold">Members ({nudgePreview.members.length}):</span> {nudgePreview.members.join(', ')}
                </p>
              )}
              {nudgePreview.friends.length > 0 && (
                <p className="text-lg">
                  <span className="font-semibold">Your friends ({nudgePreview.friends.length}):</span> {nudgePreview.friends.join(', ')}
                </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button onClick={() => nudge(true)} disabled={busy} className={`${primaryBtn} flex-1`}>
                  {busy ? 'Sending…' : 'Send it'}
                </button>
                <button onClick={() => setNudgePreview(null)} className={`${secondaryBtn} flex-1`}>
                  Never mind
                </button>
              </div>
            </section>
          ) : (
            <button onClick={() => nudge(false)} disabled={busy} className={`${secondaryBtn} w-full`}>
              Remind people who haven&rsquo;t answered
            </button>
          )
        )}

        {/* The host writing to everyone who signed up, e.g. to ask about singles. */}
        {p.isPoster && !closedText && (
          writing ? (
            <section className="space-y-3 rounded-3xl border-2 border-emerald-300 bg-white p-6">
              <h2 className="text-2xl font-bold">Message the players</h2>
              <p className="text-lg text-slate-600">
                Goes by email to everyone who signed up. When they reply, it comes straight to you.
              </p>
              <textarea
                value={msg}
                onChange={(e) => {
                  setMsg(e.target.value);
                  setPreview(null);
                }}
                rows={4}
                maxLength={1000}
                placeholder="Only two of us so far. Would you be OK playing singles?"
                className="w-full rounded-2xl border-2 border-slate-300 px-4 py-3 text-xl"
              />
              {preview ? (
                <div className="space-y-3 rounded-2xl bg-slate-50 p-4">
                  <p className="text-lg">
                    <span className="font-semibold">This goes to:</span> {preview.recipients.join(', ')}
                  </p>
                  <p className="text-lg text-slate-600">
                    <span className="font-semibold">Subject:</span> {preview.subject}
                  </p>
                  {preview.noEmail.length > 0 && (
                    <p className="text-base text-slate-500">
                      No email on file for {preview.noEmail.join(', ')}, so they won&rsquo;t get it.
                    </p>
                  )}
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <button onClick={() => sendMessage(true)} disabled={busy} className={`${primaryBtn} flex-1`}>
                      {busy ? 'Sending…' : 'Send it'}
                    </button>
                    <button onClick={() => setPreview(null)} className={`${secondaryBtn} flex-1`}>
                      Edit
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button onClick={() => sendMessage(false)} disabled={busy} className={`${primaryBtn} flex-1`}>
                    {busy ? 'One moment…' : 'Next'}
                  </button>
                  <button onClick={() => { setWriting(false); setMsg(''); setPreview(null); }} className={`${secondaryBtn} flex-1`}>
                    Never mind
                  </button>
                </div>
              )}
            </section>
          ) : (
            <button onClick={() => setWriting(true)} className={`${secondaryBtn} w-full`}>
              Message the players
            </button>
          )
        )}

        {p.isPoster && !closedText && (
          confirming === 'cancel' ? (
            <div className="space-y-3 rounded-3xl border-2 border-rose-200 bg-white p-6">
              <p className="text-xl font-semibold">Cancel this game?</p>
              <p className="text-lg text-slate-600">Not enough players? Everyone who signed up gets an email saying it&rsquo;s off.</p>
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
            See all {p.clubName} games on CourtConnect
          </Link>
        </p>
      </div>
    </main>
  );
}

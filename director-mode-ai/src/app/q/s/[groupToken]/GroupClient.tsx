'use client';

/**
 * A group's own page: the running timer, or its place in line.
 *
 * Polls every 5 seconds. The poll is also what moves the club's register
 * forward (see reconcileClub), so a page left open on a bench is part of how
 * "Court 4 is yours" happens on time. The countdown ticks locally between
 * polls, anchored to the server's clock so a phone set five minutes fast still
 * shows the right time left.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { groupView } from '@/lib/checkin/views';
import { api, clock, countdown, PLAY_LABEL, rememberGroup } from '@/lib/checkin/client';
import { BigButton, Card, ErrorNote, Footer, Lead, MUTED, Shell, TextField, Title } from '@/components/checkin/PhoneUi';

type GroupData = ReturnType<typeof groupView>;

const END_REASON: Record<string, string> = {
  done: 'You finished.',
  checkout: 'You checked out.',
  limit: 'Your time was up and a waiting group took the court.',
  bumped: 'A waiting group took the court.',
  max: 'The session reached its maximum length.',
  block: 'The court was booked for club use.',
  staff: 'Staff cleared the court.',
};

export default function GroupClient({ token }: { token: string }) {
  const [data, setData] = useState<GroupData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDone, setConfirmDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [skew, setSkew] = useState(0);
  const [, tick] = useState(0);
  const lastOffer = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<GroupData>(`/api/checkin/g/${token}`);
    if (!res.ok) {
      setLoadError(res.data.error || 'We could not find this check-in.');
      return;
    }
    setData(res.data);
    if (res.data.now) setSkew(Date.parse(res.data.now) - Date.now());
    rememberGroup(res.data.club.slug, token);
  }, [token]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 5000);
    const clockTick = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clockTick);
    };
  }, [load]);

  // Buzz once when a court is offered: the phone may be in a pocket.
  useEffect(() => {
    if (data?.kind === 'wait' && data.wait.status === 'offered' && lastOffer.current !== data.wait.offerExpiresAt) {
      lastOffer.current = data.wait.offerExpiresAt;
      try {
        navigator.vibrate?.([300, 150, 300]);
      } catch {
        /* not supported */
      }
    }
  }, [data]);

  async function act(action: 'done' | 'add_player' | 'leave' | 'claim', name?: string) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/checkin/g/${token}`, { method: 'POST', body: { action, name } });
    setBusy(false);
    if (!res.ok) setError(res.data.error || 'That did not work. Try again.');
    setConfirmDone(false);
    setAdding(false);
    setNewName('');
    await load();
  }

  if (loadError) {
    return (
      <Shell clubName="Check-in">
        <Title tone="bad">Not found</Title>
        <Lead>{loadError}</Lead>
      </Shell>
    );
  }
  if (!data) {
    return (
      <Shell clubName="">
        <p className="mt-10 text-center text-[20px]" style={{ color: MUTED }}>
          Loading…
        </p>
      </Shell>
    );
  }

  const tz = data.club.timezone;
  const now = Date.now() + skew;
  const shell = (children: React.ReactNode) => (
    <Shell clubName={data.club.name} logoUrl={data.club.logoUrl}>
      {children}
    </Shell>
  );

  /* -------------------------------------------------------------- session */
  if (data.kind === 'session') {
    const s = data.session;
    const isCourt = s.spaceKind === 'court';

    if (s.status === 'ended') {
      return shell(
        <>
          <Title>{isCourt ? 'Thanks for playing' : 'Checked out'}</Title>
          <Lead>
            {s.spaceName} · {s.endReason ? END_REASON[s.endReason] : ''} {s.endedAt ? `(${clock(s.endedAt, tz)})` : ''}
          </Lead>
          {isCourt ? <Card tone="info">The court is free for the next group.</Card> : null}
          <Footer>You can close this page.</Footer>
        </>,
      );
    }

    if (!isCourt) {
      return shell(
        <>
          <Title tone="good">You’re checked in</Title>
          <Lead>
            {s.spaceName} · since {clock(s.startedAt, tz)}
          </Lead>
          <Card>
            <div className="text-[22px] font-bold">{s.players.join(', ')}</div>
            {s.guestCount > 0 ? (
              <div className="mt-1 text-[19px]">
                + {s.guestCount} guest{s.guestCount === 1 ? '' : 's'}
                {s.guestNames.length ? `: ${s.guestNames.join(', ')}` : ''}
              </div>
            ) : null}
          </Card>
          {data.pool ? (
            <Card tone="info">
              <div className="text-[40px] font-extrabold leading-none">
                {data.pool.headcount}
                {data.pool.capacity !== null ? <span className="text-[22px]" style={{ color: MUTED }}> of {data.pool.capacity}</span> : null}
              </div>
              <div className="mt-1 text-[18px]" style={{ color: MUTED }}>
                people here now
              </div>
            </Card>
          ) : null}
          <ErrorNote>{error}</ErrorNote>
          {confirmDone ? (
            <>
              <Lead>Check out now?</Lead>
              <BigButton variant="danger" disabled={busy} onClick={() => act('done')}>
                Yes, check out
              </BigButton>
              <BigButton variant="secondary" onClick={() => setConfirmDone(false)}>
                Not yet
              </BigButton>
            </>
          ) : (
            <BigButton variant="secondary" onClick={() => setConfirmDone(true)}>
              Check out
            </BigButton>
          )}
        </>,
      );
    }

    const untilMs = s.until ? Date.parse(s.until) : null;
    const left = untilMs !== null ? untilMs - now : null;
    const timeUp = s.limitActive && left !== null && left <= 0;
    return shell(
      <>
        <div className="text-[20px] font-semibold" style={{ color: MUTED }}>
          {s.spaceName} · {PLAY_LABEL[s.playType]}
          {s.limitActive && s.until ? ` · until ${clock(s.until, tz)}` : ''}
        </div>

        {s.limitActive && left !== null ? (
          <div
            className="mt-3 rounded-3xl py-8 text-center"
            style={{ background: timeUp ? '#9b1c1c' : '#0f5f6b', color: '#fff' }}
            aria-live="polite"
          >
            <div className="text-[18px] font-semibold uppercase tracking-wider opacity-90">{timeUp ? 'Time is up' : 'Time left'}</div>
            <div className="mt-1 font-extrabold tabular-nums" style={{ fontSize: 72, lineHeight: 1 }}>
              {timeUp ? '0:00' : countdown(left)}
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-3xl py-8 text-center" style={{ background: '#0b6b3a', color: '#fff' }}>
            <div className="text-[18px] font-semibold uppercase tracking-wider opacity-90">Playing for</div>
            <div className="mt-1 font-extrabold tabular-nums" style={{ fontSize: 72, lineHeight: 1 }}>
              {countdown(now - Date.parse(s.startedAt))}
            </div>
          </div>
        )}

        {s.heldFor || timeUp ? (
          <Card tone="bad">
            <div className="text-[21px] font-bold">A waiting group has this court.</div>
            <div className="mt-1 text-[19px]">Please finish your point and tap “We’re done”.</div>
          </Card>
        ) : data.queueLength > 0 ? (
          <Card tone="warn">
            <div className="text-[21px] font-bold">
              {data.queueLength} {data.queueLength === 1 ? 'group' : 'groups'} waiting
            </div>
            <div className="mt-1 text-[19px]">Please finish by {clock(s.limitEndsAt, tz)}.</div>
          </Card>
        ) : (
          <Card tone="good">
            <div className="text-[21px] font-bold">No one waiting, keep playing</div>
            <div className="mt-1 text-[18px]">
              If a group signs up, your limit is {clock(s.limitEndsAt, tz)}.
            </div>
          </Card>
        )}

        <Card>
          <div className="text-[18px]" style={{ color: MUTED }}>
            On court
          </div>
          <div className="text-[21px] font-semibold">{s.players.join(', ')}</div>
        </Card>

        <ErrorNote>{error}</ErrorNote>

        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim()) act('add_player', newName.trim());
            }}
          >
            <TextField label="Player’s name" value={newName} onChange={setNewName} autoFocus />
            <BigButton type="submit" disabled={busy || !newName.trim()}>
              Add
            </BigButton>
            <BigButton variant="secondary" onClick={() => setAdding(false)}>
              Cancel
            </BigButton>
          </form>
        ) : confirmDone ? (
          <>
            <Lead>Leave {s.spaceName} now?</Lead>
            <BigButton variant="danger" disabled={busy} onClick={() => act('done')}>
              Yes, we’re done
            </BigButton>
            <BigButton variant="secondary" onClick={() => setConfirmDone(false)}>
              Keep playing
            </BigButton>
          </>
        ) : (
          <>
            <BigButton variant="danger" onClick={() => setConfirmDone(true)}>
              We’re done
            </BigButton>
            <BigButton variant="secondary" onClick={() => setAdding(true)}>
              Add a player
            </BigButton>
          </>
        )}
        <Footer>Started {clock(s.startedAt, tz)}. Keep this page open, or scan the court sign again to come back.</Footer>
      </>,
    );
  }

  /* ----------------------------------------------------------------- wait */
  const w = data.wait;
  if (w.status === 'offered') {
    const left = w.offerExpiresAt ? Date.parse(w.offerExpiresAt) - now : 0;
    return shell(
      <>
        <div className="mt-2 rounded-3xl px-4 py-8 text-center" style={{ background: '#0b6b3a', color: '#fff' }} aria-live="assertive">
          <div className="font-extrabold" style={{ fontSize: 44, lineHeight: 1.05 }}>
            {w.offeredSpace} is yours
          </div>
          <div className="mt-3 text-[21px]">
            Start by {clock(w.offerExpiresAt, tz)} ({countdown(left)})
          </div>
        </div>
        <Lead>Walk over, then tap Start playing when you are on the court.</Lead>
        <ErrorNote>{error}</ErrorNote>
        <BigButton variant="good" disabled={busy} onClick={() => act('claim')}>
          {busy ? 'Starting…' : 'Start playing'}
        </BigButton>
        <BigButton variant="secondary" disabled={busy} onClick={() => act('leave')}>
          We don’t need it
        </BigButton>
      </>,
    );
  }

  if (w.status === 'waiting') {
    return shell(
      <>
        <Title>{w.position === 1 ? 'You’re next' : `You’re #${w.position} in line`}</Title>
        <Lead>
          {w.estimate ? `Expect a court around ${clock(w.estimate, tz)}. ` : ''}We’ll show it here the moment a court is yours.
        </Lead>
        <Card>
          <div className="text-[18px]" style={{ color: MUTED }}>
            {PLAY_LABEL[w.playType]} · joined {clock(w.joinedAt, tz)}
          </div>
          <div className="text-[21px] font-semibold">{w.players.join(', ')}</div>
        </Card>
        <Card tone="info">Keep this page open. Stay near the courts: you’ll have a few minutes to start once a court is offered.</Card>
        <ErrorNote>{error}</ErrorNote>
        <BigButton variant="secondary" disabled={busy} onClick={() => act('leave')}>
          Leave the wait list
        </BigButton>
      </>,
    );
  }

  const gone: Record<string, string> = {
    left: 'You left the wait list.',
    missed: 'Your court offer ran out before you started. Scan a court sign to sign in again.',
    expired: 'Your place on the list expired.',
    removed: 'Staff removed you from the wait list.',
    playing: 'You started playing.',
  };
  return shell(
    <>
      <Title>Off the list</Title>
      <Lead>{gone[w.status] ?? ''}</Lead>
    </>,
  );
}

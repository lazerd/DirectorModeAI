'use client';

/**
 * What a phone shows after scanning a sign on the fence.
 *
 * One decision per screen:
 *   court free     -> "Court 4 is free. Start playing?" -> singles/doubles -> names -> timer
 *   court in use   -> who is on and until when -> "Join the wait list" -> ... -> place in line
 *   kiosk sign     -> the line and the courts -> join
 *   pool gate      -> name + guests -> checked in
 *
 * A phone that already has a running court, or a court offered to it, is
 * sent there instead of being asked to sign in twice.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { scanView } from '@/lib/checkin/views';
import {
  api,
  clock,
  groupFor,
  location,
  PLAY_LABEL,
  rememberEmail,
  rememberGroup,
  rememberNames,
  rememberedEmail,
  rememberedNames,
} from '@/lib/checkin/client';
import { BigButton, Card, ErrorNote, Footer, Lead, MUTED, Shell, TextField, Title } from '@/components/checkin/PhoneUi';

type ScanData = ReturnType<typeof scanView>;
type Step = 'view' | 'type' | 'names';
type Mode = 'start' | 'wait' | 'visit';

export default function ScanClient({
  token,
  clubSlug,
  me,
}: {
  token: string;
  clubSlug: string;
  me: { name: string | null } | null;
}) {
  const router = useRouter();
  const [data, setData] = useState<ScanData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('view');
  const [mode, setMode] = useState<Mode>('start');
  const [playType, setPlayType] = useState<'singles' | 'doubles' | 'other'>('doubles');
  const [names, setNames] = useState<string[]>(['', '']);
  const [firstIsMe, setFirstIsMe] = useState(false);
  const [email, setEmail] = useState('');
  const [guests, setGuests] = useState(0);
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [known, setKnown] = useState<string[]>([]);

  const load = useCallback(async () => {
    const g = groupFor(clubSlug);
    const res = await api<ScanData>(`/api/checkin/q/${token}${g ? `?g=${g}` : ''}`);
    if (!res.ok) setLoadError(res.data.error || 'This sign could not be read.');
    else setData(res.data);
  }, [token, clubSlug]);

  useEffect(() => {
    load();
    setKnown(rememberedNames());
    setEmail(rememberedEmail());
  }, [load]);

  // Keep the view honest while someone stands there deciding.
  useEffect(() => {
    if (step !== 'view') return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [step, load]);

  const tz = data?.club.timezone ?? 'America/Los_Angeles';
  const minPlayers = data?.space.minPlayers ?? 1;

  function beginNames(nextMode: Mode, type?: 'singles' | 'doubles' | 'other') {
    if (type) setPlayType(type);
    setMode(nextMode);
    const want = nextMode === 'visit' ? 1 : Math.max(minPlayers, type === 'doubles' ? 2 : 1);
    const first = me?.name || known[0] || '';
    setFirstIsMe(!!me?.name);
    setNames(Array.from({ length: want }, (_, i) => (i === 0 ? first : '')));
    setError(null);
    setStep('names');
  }

  async function submit() {
    if (!data) return;
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (clean.length < (mode === 'visit' ? 1 : minPlayers)) {
      setError(
        mode === 'visit'
          ? 'Type your name to check in.'
          : `${minPlayers} players need to be here. Add ${minPlayers === 2 ? 'your partner’s' : 'each player’s'} name.`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const coords = data.geofence ? await location() : null;
      const res = await api<{ group_token: string; url: string }>(`/api/checkin/q/${token}`, {
        method: 'POST',
        body: {
          action: mode === 'wait' ? 'wait' : 'start',
          play_type: mode === 'visit' ? undefined : playType,
          names: clean,
          email: email.trim() || undefined,
          first_is_me: firstIsMe && clean[0] === (me?.name ?? '').trim(),
          guests: mode === 'visit' ? guests : undefined,
          guest_names: mode === 'visit' ? guestNames.map((g) => g.trim()).filter(Boolean) : undefined,
          wait_token: data.mine?.kind === 'wait' ? data.mine.token : undefined,
          ...(coords ?? {}),
        },
      });
      if (!res.ok) {
        setError(res.data.error || 'That did not work. Try again.');
        if (res.status === 409) load();
        return;
      }
      rememberNames(clean);
      if (email.trim()) rememberEmail(email.trim());
      rememberGroup(clubSlug, res.data.group_token);
      router.push(res.data.url);
    } finally {
      setBusy(false);
    }
  }

  async function claim(groupToken: string) {
    setBusy(true);
    setError(null);
    const res = await api(`/api/checkin/g/${groupToken}`, { method: 'POST', body: { action: 'claim' } });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error || 'Could not start.');
      load();
      return;
    }
    router.push(`/q/s/${groupToken}`);
  }

  const otherFree = useMemo(
    () => (data ? data.courts.filter((c) => c.state === 'free' && c.name !== data.space.name).map((c) => c.name) : []),
    [data],
  );

  if (loadError) {
    return (
      <Shell clubName="Check-in">
        <Title tone="bad">This sign is not active</Title>
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

  const { space, court } = data;
  const shell = (children: React.ReactNode) => (
    <Shell clubName={data.club.name} logoUrl={data.club.logoUrl}>
      {children}
    </Shell>
  );

  if (!data.enabled) {
    return shell(
      <>
        <Title>Check-in is paused</Title>
        <Lead>Use the club’s usual sign-in today.</Lead>
      </>,
    );
  }

  /* ---------------------------------------------------- names (all modes) */
  if (step === 'names') {
    const heading =
      mode === 'visit' ? `${space.name} check-in` : mode === 'wait' ? 'Join the wait list' : `${space.name} · ${PLAY_LABEL[playType]}`;
    return shell(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Title>{heading}</Title>
        <Lead>{mode === 'visit' ? 'Your name, please.' : minPlayers > 1 ? `Names of the players here (at least ${minPlayers}).` : 'Who is playing?'}</Lead>
        <datalist id="known-names">
          {known.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        {names.map((n, i) => (
          <TextField
            key={i}
            label={mode === 'visit' ? 'Member name' : i === 0 ? 'Your name' : `Player ${i + 1}`}
            value={n}
            list="known-names"
            autoComplete="off"
            autoFocus={i === 0 && !n}
            onChange={(v) => setNames((all) => all.map((x, j) => (j === i ? v : x)))}
          />
        ))}
        {mode !== 'visit' && names.length < (playType === 'singles' ? 2 : 4) ? (
          <BigButton variant="secondary" onClick={() => setNames((all) => [...all, ''])}>
            + Add a player
          </BigButton>
        ) : null}

        {mode === 'visit' && space.trackGuests ? (
          <Card>
            <div className="text-[19px] font-semibold">Guests with you</div>
            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="One fewer guest"
                onClick={() => {
                  setGuests((g) => Math.max(0, g - 1));
                  setGuestNames((gn) => gn.slice(0, Math.max(0, guests - 1)));
                }}
                className="h-14 w-14 rounded-xl text-[30px] font-bold"
                style={{ background: '#fff', border: '2px solid #c9d2cf', color: '#10231f' }}
              >
                −
              </button>
              <div className="text-[40px] font-extrabold">{guests}</div>
              <button
                type="button"
                aria-label="One more guest"
                onClick={() => setGuests((g) => Math.min(20, g + 1))}
                className="h-14 w-14 rounded-xl text-[30px] font-bold"
                style={{ background: '#fff', border: '2px solid #c9d2cf', color: '#10231f' }}
              >
                +
              </button>
            </div>
            {Array.from({ length: guests }, (_, i) => (
              <TextField
                key={i}
                label={`Guest ${i + 1} name${space.guestNamesRequired ? '' : ' (optional)'}`}
                value={guestNames[i] ?? ''}
                onChange={(v) =>
                  setGuestNames((gn) => {
                    const next = [...gn];
                    next[i] = v;
                    return next;
                  })
                }
              />
            ))}
          </Card>
        ) : null}

        {mode === 'wait' ? (
          <TextField
            label="Email (optional) — we’ll email you when a court is ready"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />
        ) : null}

        <ErrorNote>{error}</ErrorNote>
        <BigButton type="submit" variant={mode === 'wait' ? 'primary' : 'good'} disabled={busy}>
          {busy ? 'One moment…' : mode === 'visit' ? 'Check in' : mode === 'wait' ? 'Put us on the list' : 'Start the clock'}
        </BigButton>
        <BigButton variant="secondary" onClick={() => setStep(mode === 'visit' ? 'view' : 'type')}>
          Back
        </BigButton>
      </form>,
    );
  }

  /* ------------------------------------------------------ play type choice */
  if (step === 'type') {
    const opts: { key: 'singles' | 'doubles' | 'other'; label: string; minutes: number }[] = [
      { key: 'doubles', label: 'Doubles', minutes: space.doublesMinutes },
      { key: 'singles', label: 'Singles', minutes: space.singlesMinutes },
      { key: 'other', label: 'Ball machine / other', minutes: space.otherMinutes },
    ];
    return shell(
      <>
        <Title>{mode === 'wait' ? 'What will you play?' : 'Singles or doubles?'}</Title>
        <Lead>
          {space.limitsOnlyWhenWaiting ? 'Time limits apply when others are waiting.' : 'Time limits always apply.'}
        </Lead>
        {opts.map((o) => (
          <BigButton key={o.key} variant="secondary" onClick={() => beginNames(mode, o.key)}>
            <span className="flex items-center justify-between">
              <span>{o.label}</span>
              <span className="text-[18px] font-semibold" style={{ color: MUTED }}>
                {o.minutes} min
              </span>
            </span>
          </BigButton>
        ))}
        <BigButton variant="secondary" onClick={() => setStep('view')}>
          Back
        </BigButton>
      </>,
    );
  }

  /* ------------------------------------------------------------ first view */
  const mine = data.mine;
  const waitingLine =
    data.queueLength === 0 ? 'No one is waiting.' : `${data.queueLength} ${data.queueLength === 1 ? 'group is' : 'groups are'} waiting.`;

  const mineBanner =
    mine?.kind === 'session' ? (
      <Card tone="info">
        <div className="text-[19px] font-semibold">You have {mine.spaceName} running.</div>
        <BigButton onClick={() => router.push(`/q/s/${mine.token}`)}>Open my timer</BigButton>
      </Card>
    ) : mine?.kind === 'wait' && !mine.offeredHere ? (
      <Card tone="info">
        <div className="text-[19px] font-semibold">You are on the wait list.</div>
        <BigButton onClick={() => router.push(`/q/s/${mine.token}`)}>See my place in line</BigButton>
      </Card>
    ) : null;

  // This court was offered to this phone's group.
  if (mine?.kind === 'wait' && mine.offeredHere) {
    return shell(
      <>
        <Title tone="good">{space.name} is yours</Title>
        <Lead>You were next on the wait list. Start when you are on the court.</Lead>
        <ErrorNote>{error}</ErrorNote>
        <BigButton variant="good" disabled={busy} onClick={() => claim(mine.token)}>
          {busy ? 'Starting…' : 'Start playing'}
        </BigButton>
      </>,
    );
  }

  if (space.kind === 'pool' || space.kind === 'room' || space.kind === 'other') {
    const pool = data.pool;
    const full = pool && pool.capacity !== null && pool.headcount >= pool.capacity;
    return shell(
      <>
        <Title tone={full ? 'bad' : undefined}>{full ? `${space.name} is full` : `Welcome to the ${space.name.toLowerCase()}`}</Title>
        {pool ? (
          <Card tone={full ? 'bad' : 'info'}>
            <div className="text-[44px] font-extrabold leading-none">
              {pool.headcount}
              {pool.capacity !== null ? <span className="text-[24px] font-bold" style={{ color: MUTED }}> of {pool.capacity}</span> : null}
            </div>
            <div className="mt-1 text-[18px]" style={{ color: MUTED }}>
              people checked in now
            </div>
          </Card>
        ) : null}
        {mineBanner}
        {!space.active ? <Lead>{space.name} is closed right now.</Lead> : null}
        <ErrorNote>{error}</ErrorNote>
        {space.active && !full ? <BigButton variant="good" onClick={() => beginNames('visit')}>Check in</BigButton> : null}
        <Footer>Replaces the paper sign-in sheet at the gate.</Footer>
      </>,
    );
  }

  if (space.kind === 'kiosk') {
    return shell(
      <>
        <Title>Court wait list</Title>
        <Lead>
          {waitingLine}
          {data.nextCourtAt ? ` If you join now, expect a court around ${clock(data.nextCourtAt, tz)}.` : ''}
        </Lead>
        {mineBanner}
        {otherFree.length && data.queueLength === 0 ? (
          <Card tone="good">
            <div className="text-[20px] font-bold">{otherFree.join(', ')} {otherFree.length === 1 ? 'is' : 'are'} free now.</div>
            <div className="mt-1 text-[18px]">Walk over and scan the sign on that court.</div>
          </Card>
        ) : null}
        <CourtList courts={data.courts} tz={tz} />
        {!mine ? (
          <BigButton
            onClick={() => {
              setMode('wait');
              setStep('type');
            }}
          >
            Join the wait list
          </BigButton>
        ) : null}
      </>,
    );
  }

  /* ---------------------------------------------------------------- court */
  const c = court!;
  let body: React.ReactNode;
  if (c.state === 'free') {
    body = (
      <>
        <Title tone="good">{space.name} is free</Title>
        <Lead>Start playing?</Lead>
        {mineBanner}
        {!mine ? (
          <BigButton
            variant="good"
            onClick={() => {
              setMode('start');
              setStep('type');
            }}
          >
            Start playing
          </BigButton>
        ) : null}
      </>
    );
  } else {
    const who =
      c.state === 'blocked'
        ? `Booked for ${c.blockLabel ?? 'club use'} until ${clock(c.until, tz)}.`
        : c.state === 'held'
          ? `Held for ${c.heldFor} from the wait list until ${clock(c.heldUntil, tz)}.`
          : c.state === 'closed'
            ? 'Closed right now.'
            : c.limitActive
              ? `${c.players} · ${PLAY_LABEL[c.playType ?? 'other']} · until ${clock(c.until, tz)}`
              : `${c.players} · ${PLAY_LABEL[c.playType ?? 'other']} · no one waiting, playing on`;
    body = (
      <>
        <Title tone="warn">{space.name} is {c.state === 'blocked' ? 'booked' : c.state === 'held' ? 'held' : c.state === 'closed' ? 'closed' : 'in use'}</Title>
        <Card tone={c.state === 'overtime' ? 'warn' : undefined}>
          <div className="text-[20px] font-semibold">{who}</div>
          {c.state === 'overtime' ? <div className="mt-1 text-[18px]">Their time is up; the court goes to the next group.</div> : null}
        </Card>
        {otherFree.length && data.queueLength === 0 ? (
          <Card tone="good">
            <div className="text-[20px] font-bold">{otherFree.join(', ')} {otherFree.length === 1 ? 'is' : 'are'} free right now.</div>
            <div className="mt-1 text-[18px]">Scan the sign on that court to start.</div>
          </Card>
        ) : (
          <Lead>
            {waitingLine}
            {data.nextCourtAt ? ` If you join now, expect a court around ${clock(data.nextCourtAt, tz)}.` : ''}
          </Lead>
        )}
        {mineBanner}
        {!mine ? (
          <BigButton
            onClick={() => {
              setMode('wait');
              setStep('type');
            }}
          >
            Join the wait list
          </BigButton>
        ) : null}
      </>
    );
  }

  return shell(
    <>
      {body}
      <ErrorNote>{error}</ErrorNote>
      <Footer>
        {space.singlesMinutes} min singles · {space.doublesMinutes} min doubles
        {space.limitsOnlyWhenWaiting ? ' when others are waiting' : ''}
        {minPlayers > 1 ? ` · ${minPlayers} players must be present` : ''}
      </Footer>
    </>,
  );
}

function CourtList({ courts, tz }: { courts: ScanData['courts']; tz: string }) {
  if (!courts.length) return null;
  const label = (c: ScanData['courts'][number]) =>
    c.state === 'free'
      ? 'Free'
      : c.state === 'held'
        ? 'Held for next group'
        : c.state === 'blocked'
          ? `Booked till ${clock(c.until, tz)}`
          : c.state === 'closed'
            ? 'Closed'
            : c.until
              ? `Until ${clock(c.until, tz)}`
              : 'In play';
  return (
    <div className="mt-4 overflow-hidden rounded-2xl" style={{ border: '2px solid #dde3e1', background: '#fff' }}>
      {courts.map((c, i) => (
        <div key={c.name} className="flex items-center justify-between px-4 py-3 text-[19px]" style={{ borderTop: i ? '1px solid #e6ebe9' : undefined }}>
          <span className="font-semibold">{c.name}</span>
          <span style={{ color: c.state === 'free' ? '#0b6b3a' : MUTED, fontWeight: c.state === 'free' ? 700 : 500 }}>{label(c)}</span>
        </div>
      ))}
    </div>
  );
}

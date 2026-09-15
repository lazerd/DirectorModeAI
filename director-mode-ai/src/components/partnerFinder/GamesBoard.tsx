'use client';

/**
 * CourtConnect — the member's board.
 *
 * One page, top to bottom, no tabs: post a game, your games, games you're in,
 * games looking for players, then your settings. Tabs hide things, and this is
 * for members who should not have to hunt for the button they came for.
 *
 * Used on /member/games and, for a signed-in member, on the club site's
 * /c/[slug]/play. Data comes from /api/play/board; every change goes through
 * the API and the board reloads, so what's on screen is what the club has.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import type { Board, BoardGame } from '@/lib/partnerFinder/server';
import {
  DURATIONS,
  FORMATS,
  FORMAT_LABEL,
  MAX_SPOTS,
  NTRP_LEVELS,
  durationLabel,
  needsLabel,
  ratingLabel,
  type GameFormat,
} from '@/lib/partnerFinder/format';
import {
  LevelPicker,
  Notice,
  PeopleList,
  dangerBtn,
  postJson,
  primaryBtn,
  secondaryBtn,
} from './ui';

type Msg = { tone: 'good' | 'info' | 'bad'; text: string } | null;

/* ------------------------------------------------------------ date helpers */

/** Today's date at the club, as [y, m, d]. */
function clubToday(tz: string): [number, number, number] {
  const s = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: tz }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return [y, m, d];
}

function dayOptions(tz: string, count = 30) {
  const [y, m, d] = clubToday(tz);
  return Array.from({ length: count }, (_, i) => {
    // Noon UTC on a pure calendar date, formatted in UTC: no zone can shift the day.
    const dt = new Date(Date.UTC(y, m - 1, d + i, 12));
    const value = dt.toISOString().slice(0, 10);
    const label = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(dt);
    return { value, label: i === 0 ? `Today, ${label}` : i === 1 ? `Tomorrow, ${label}` : label };
  });
}

const TIME_OPTIONS = Array.from({ length: 31 }, (_, i) => {
  const mins = 6 * 60 + i * 30; // 6:00am to 9:00pm
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  const value = `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const label = `${h % 12 === 0 ? 12 : h % 12}:${String(mm).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
  return { value, label };
});

const clamp = (n: number) => Math.min(Math.max(n, NTRP_LEVELS[0]), NTRP_LEVELS[NTRP_LEVELS.length - 1]);

/* ------------------------------------------------------------------ board */

export default function GamesBoard({ clubId }: { clubId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/play/board?club=${encodeURIComponent(clubId)}`, { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not load games.');
      setBoard(j as Board);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [clubId]);

  useEffect(() => {
    load();
  }, [load]);

  const say = (m: Msg) => {
    setMsg(m);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (loadError) return <Notice tone="bad">{loadError}</Notice>;
  if (!board) {
    return (
      <div className="flex items-center gap-3 py-10 text-lg text-slate-600">
        <Loader2 className="h-6 w-6 animate-spin" /> Loading games…
      </div>
    );
  }

  return (
    <div className="space-y-8 text-lg text-slate-900">
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

      {board.me.ntrp == null && !posting && (
        <LevelPrompt clubId={board.club.id} onSaved={(m) => { say(m); load(); }} />
      )}

      {posting ? (
        <PostForm
          board={board}
          onCancel={() => setPosting(false)}
          onPosted={(text) => {
            setPosting(false);
            say({ tone: 'good', text });
            load();
          }}
        />
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => {
              setMsg(null);
              setPosting(true);
            }}
            disabled={board.postsLeftToday === 0}
            className={`${primaryBtn} w-full text-2xl`}
          >
            <CalendarPlus className="h-7 w-7" /> Post a game that needs players
          </button>
          {board.postsLeftToday === 0 && (
            <p className="text-center text-slate-600">You&rsquo;ve posted the most games allowed today. You can post again tomorrow.</p>
          )}
        </div>
      )}

      {board.mine.length > 0 && (
        <Section title="Your games">
          {board.mine.map((g) => (
            <GameCard key={g.id} game={g} onDone={(m) => { say(m); load(); }} />
          ))}
        </Section>
      )}

      {board.joined.length > 0 && (
        <Section title="Games you're in">
          {board.joined.map((g) => (
            <GameCard key={g.id} game={g} onDone={(m) => { say(m); load(); }} />
          ))}
        </Section>
      )}

      <Section title="Games looking for players">
        {board.open.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-600">
            No games need players right now. Post one, and we&rsquo;ll email members at your level.
          </div>
        ) : (
          board.open.map((g) => (
            <GameCard key={g.id} game={g} myLevelKnown={board.me.ntrp != null} onDone={(m) => { say(m); load(); }} />
          ))
        )}
      </Section>

      <Settings board={board} onSaved={(m) => { say(m); load(); }} />
    </div>
  );
}

/**
 * First visit with no level on file. Asked up front because a member without a
 * level can't join games that set one, and would otherwise only find out on
 * tapping "I'm in".
 */
function LevelPrompt({ clubId, onSaved }: { clubId: string; onSaved: (m: Msg) => void }) {
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  async function pick(n: number | null) {
    if (n == null) return setHidden(true);
    setBusy(true);
    const r = await postJson('/api/play/prefs', { club_id: clubId, ntrp: n });
    setBusy(false);
    onSaved(r.error ? { tone: 'bad', text: r.error } : { tone: 'good', text: `Thanks. Your level is ${n.toFixed(1)}.` });
  }

  return (
    <section className="rounded-3xl border-2 border-emerald-300 bg-white p-5 sm:p-6">
      <h2 className="text-2xl font-bold">What&rsquo;s your level?</h2>
      <p className="mb-4 mt-1 text-slate-700">
        Pick your NTRP rating so we can match you with the right games. You can change it later.
      </p>
      <LevelPicker value={null} onPick={pick} busy={busy} allowNotSure />
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-2xl font-bold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------- card */

function GameCard({
  game: g,
  myLevelKnown = true,
  onDone,
}: {
  game: BoardGame;
  myLevelKnown?: boolean;
  onDone: (m: Msg) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function act(action: 'join' | 'leave' | 'cancel') {
    setBusy(true);
    const r = await postJson<{ ok: boolean; result: string; message: string }>(`/api/play/games/${g.id}`, { action });
    setBusy(false);
    setConfirm(false);
    if (r.error) return onDone({ tone: 'bad', text: r.error });
    onDone({ tone: r.ok ? 'good' : 'info', text: r.message });
  }

  const facts = [
    // A full game already wears the "Full" badge.
    ...(g.status === 'full' ? [] : [needsLabel(g.spotsLeft)]),
    g.rating ? `Level ${g.rating}` : 'Any level',
    g.duration,
    g.court || 'Court to be decided',
  ];

  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-2xl font-bold leading-tight">
          {g.day.split(',')[0]} {g.clock} {g.formatLabel}
        </h3>
        {g.status === 'full' && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-base font-semibold text-emerald-900">Full</span>
        )}
      </div>
      <p className="mt-1 text-slate-600">{g.day}</p>
      <p className="mt-2 font-semibold text-slate-800">{facts.join(' · ')}</p>
      {g.note && <p className="mt-3 border-l-4 border-emerald-600 pl-4 italic text-slate-700">&ldquo;{g.note}&rdquo;</p>}
      {!g.isMine && <p className="mt-2 text-slate-600">Posted by {g.poster}</p>}

      {(g.isMine || g.imIn) && (
        <div className="mt-4 rounded-2xl bg-slate-50 p-4">
          <p className="font-semibold">{g.players.length ? 'Playing:' : 'Nobody has joined yet.'}</p>
          {g.players.length > 0 && (
            <div className="mt-1">
              <PeopleList
                people={[
                  { name: g.isMine ? 'You' : g.poster, note: 'posted the game' },
                  ...g.players.map((n) => ({ name: n })),
                ]}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        {g.isMine ? (
          confirm ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button onClick={() => act('cancel')} disabled={busy} className={`${dangerBtn} flex-1`}>
                Yes, cancel the game
              </button>
              <button onClick={() => setConfirm(false)} className={`${secondaryBtn} flex-1`}>
                Keep it
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirm(true)} className={`${secondaryBtn} w-full sm:w-auto`}>
              Cancel this game
            </button>
          )
        ) : g.imIn ? (
          confirm ? (
            <div className="flex flex-col gap-3 sm:flex-row">
              <button onClick={() => act('leave')} disabled={busy} className={`${dangerBtn} flex-1`}>
                Yes, I can&rsquo;t make it
              </button>
              <button onClick={() => setConfirm(false)} className={`${secondaryBtn} flex-1`}>
                Keep my spot
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirm(true)} className={`${secondaryBtn} w-full sm:w-auto`}>
              I can&rsquo;t make it
            </button>
          )
        ) : g.fitsMe ? (
          <button onClick={() => act('join')} disabled={busy} className={`${primaryBtn} w-full sm:w-auto sm:min-w-[200px]`}>
            {busy ? 'One moment…' : "I'm in"}
          </button>
        ) : (
          <p className="rounded-2xl bg-slate-50 px-4 py-3 text-slate-700">
            {myLevelKnown
              ? `This game is for ${g.rating} players.`
              : 'Pick your level at the top of this page to join this game.'}
          </p>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------- post */

function Choice<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`min-h-[52px] rounded-xl border-2 px-5 text-lg font-semibold transition ${
            value === o.value
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : 'border-slate-300 bg-white text-slate-800 hover:border-emerald-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const selectCls =
  'min-h-[52px] w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-lg text-slate-900 focus:border-emerald-600 focus:outline-none';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-lg font-bold">{label}</p>
      {hint && <p className="-mt-1 mb-2 text-base text-slate-600">{hint}</p>}
      {children}
    </div>
  );
}

function PostForm({
  board,
  onCancel,
  onPosted,
}: {
  board: Board;
  onCancel: () => void;
  onPosted: (text: string) => void;
}) {
  const tz = board.club.timezone;
  const days = useMemo(() => dayOptions(tz), [tz]);
  const my = board.me.ntrp;

  const [date, setDate] = useState(days[1].value);
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState<number>(90);
  const [format, setFormat] = useState<GameFormat>('doubles');
  const [spots, setSpots] = useState<number>(1);
  /*
   * "Any level" is the default and it means any level: null/null is what gets
   * saved. A range is only ever what the poster can see in From/To — it starts
   * around their own level the moment they choose "Choose a range".
   */
  const [anyLevel, setAnyLevel] = useState(true);
  const [min, setMin] = useState<number>(3.0);
  const [max, setMax] = useState<number>(3.5);
  const chooseLevelMode = (v: string) => {
    if (v === 'range' && anyLevel && my != null) {
      setMin(clamp(my - 0.5));
      setMax(clamp(my + 0.5));
    }
    setAnyLevel(v === 'any');
  };
  const [includeUnrated, setIncludeUnrated] = useState(true);
  const [court, setCourt] = useState('');
  const [note, setNote] = useState('');
  const [myLevel, setMyLevel] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayLabel = days.find((d) => d.value === date)?.label.replace(/^(Today|Tomorrow), /, '') ?? '';
  const timeLabel = TIME_OPTIONS.find((t) => t.value === time)?.label ?? '';
  const level = anyLevel ? '' : ratingLabel(min, max);
  const preview = `${dayLabel.split(',')[0]} ${timeLabel} ${FORMAT_LABEL[format]} ${needsLabel(spots)}${level ? ` (${level})` : ''}`;

  async function submit() {
    if (!anyLevel && min > max) return setError('The lowest level must be at or below the highest.');
    setBusy(true);
    setError(null);
    const r = await postJson<{ ok: boolean; notified: number; demo?: boolean }>('/api/play/games', {
      club_id: board.club.id,
      date,
      time,
      duration,
      format,
      spots,
      rating_min: anyLevel ? null : min,
      rating_max: anyLevel ? null : max,
      include_unrated: anyLevel ? true : includeUnrated,
      court,
      note,
      my_ntrp: my == null ? myLevel : undefined,
    });
    setBusy(false);
    if (r.error) return setError(r.error);
    onPosted(
      r.demo
        ? `Your game is posted. Demo: email not sent (would go to ${r.notified} ${r.notified === 1 ? 'person' : 'people'}).`
        : r.notified > 0
        ? `Your game is posted. We're emailing ${r.notified} ${r.notified === 1 ? 'member' : 'members'} who might want to play, and we'll email you when someone joins.`
        : "Your game is posted on the club's board. We didn't find members to email at that level yet, so others can join from the board.",
    );
  }

  const levelOptions = NTRP_LEVELS.map((n) => ({ value: n, label: n.toFixed(1) }));

  return (
    <section className="space-y-6 rounded-3xl border-2 border-emerald-200 bg-white p-5 sm:p-7">
      <h2 className="text-2xl font-bold">Post a game</h2>

      <Field label="Which day?">
        <select value={date} onChange={(e) => setDate(e.target.value)} className={selectCls}>
          {days.map((d) => (
            <option key={d.value} value={d.value}>
              {d.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="What time?">
        <select value={time} onChange={(e) => setTime(e.target.value)} className={selectCls}>
          {TIME_OPTIONS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="How long?">
        <Choice options={DURATIONS.map((d) => ({ value: d as number, label: durationLabel(d) }))} value={duration} onChange={setDuration} />
      </Field>

      <Field label="What kind of game?">
        <Choice
          options={FORMATS.map((f) => ({ value: f, label: FORMAT_LABEL[f][0].toUpperCase() + FORMAT_LABEL[f].slice(1) }))}
          value={format}
          onChange={setFormat}
        />
      </Field>

      <Field label="How many players do you need?">
        <Choice
          options={Array.from({ length: MAX_SPOTS }, (_, i) => ({ value: i + 1, label: String(i + 1) }))}
          value={spots}
          onChange={setSpots}
        />
      </Field>

      <Field label="What level?" hint="We only email members whose level fits.">
        <Choice
          options={[
            { value: 'any', label: 'Any level' },
            { value: 'range', label: 'Choose a range' },
          ]}
          value={anyLevel ? 'any' : 'range'}
          onChange={chooseLevelMode}
        />
        {!anyLevel && (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-base text-slate-600">From</span>
                <select value={min} onChange={(e) => setMin(Number(e.target.value))} className={selectCls}>
                  {levelOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-base text-slate-600">To</span>
                <select value={max} onChange={(e) => setMax(Number(e.target.value))} className={selectCls}>
                  {levelOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex min-h-[52px] cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={includeUnrated}
                onChange={(e) => setIncludeUnrated(e.target.checked)}
                className="h-7 w-7 accent-emerald-700"
              />
              <span>Also invite members whose level we don&rsquo;t know</span>
            </label>
          </div>
        )}
      </Field>

      {my == null && (
        <Field label="And your own level?" hint="Optional. It helps us send you games that suit you.">
          <LevelPicker value={myLevel} onPick={setMyLevel} allowNotSure />
        </Field>
      )}

      <Field label="Court" hint="Leave blank if it's not decided yet.">
        <input value={court} onChange={(e) => setCourt(e.target.value)} maxLength={60} placeholder="Court to be decided" className={selectCls} />
      </Field>

      <Field label="Anything else? (optional)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="For example: friendly game, bring a can of balls"
          className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-lg focus:border-emerald-600 focus:outline-none"
        />
      </Field>

      <div className="rounded-2xl bg-slate-50 p-4">
        <p className="text-base text-slate-600">Members will see:</p>
        <p className="mt-1 text-xl font-bold">{preview}</p>
      </div>

      {error && <Notice tone="bad">{error}</Notice>}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button onClick={submit} disabled={busy} className={`${primaryBtn} flex-1`}>
          {busy ? 'Posting…' : 'Post the game'}
        </button>
        <button onClick={onCancel} disabled={busy} className={`${secondaryBtn} sm:w-40`}>
          Back
        </button>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- settings */

function Settings({ board, onSaved }: { board: Board; onSaved: (m: Msg) => void }) {
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(board.me.phone ?? '');
  const [changingLevel, setChangingLevel] = useState(false);
  const clubRated = board.me.ntrpSource === 'club';

  async function save(patch: Record<string, unknown>, text: string) {
    setBusy(true);
    const r = await postJson('/api/play/prefs', { club_id: board.club.id, ...patch });
    setBusy(false);
    onSaved(r.error ? { tone: 'bad', text: r.error } : { tone: 'good', text });
  }

  return (
    <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 sm:p-7">
      <h2 className="text-2xl font-bold">Your settings</h2>

      {/* One line, not a second picker: the level is asked for once, at the top of the page. */}
      <div>
        <p className="flex min-h-[44px] flex-wrap items-center gap-x-3 text-lg">
          <span>
            <span className="font-bold">Your level:</span>{' '}
            {board.me.ntrp != null ? board.me.ntrp.toFixed(1) : 'not set yet'}
          </span>
          {clubRated ? (
            <span className="text-base text-slate-600">set by the club. Ask the tennis staff to change it.</span>
          ) : (
            board.me.ntrp != null && (
              <button
                type="button"
                onClick={() => setChangingLevel((v) => !v)}
                className="min-h-[44px] px-1 font-semibold text-emerald-800 underline"
              >
                {changingLevel ? 'close' : 'change'}
              </button>
            )
          )}
        </p>
        {changingLevel && !clubRated && (
          <div className="mt-2">
            <LevelPicker
              value={board.me.ntrp}
              busy={busy}
              onPick={(n) => {
                if (n == null) return;
                setChangingLevel(false);
                save({ ntrp: n }, `Saved. Your level is ${n.toFixed(1)}.`);
              }}
            />
          </div>
        )}
      </div>

      <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4">
        <span>
          <span className="block text-lg font-bold">Email me when a game needs players</span>
          <span className="block text-base text-slate-600">Only games at your level.</span>
        </span>
        <input
          type="checkbox"
          checked={board.me.notifyGames}
          disabled={busy}
          onChange={(e) =>
            save(
              { notify_games: e.target.checked },
              e.target.checked ? "Game emails are on." : "Game emails are off. You'll still hear about games you're in.",
            )
          }
          className="h-8 w-8 shrink-0 accent-emerald-700"
        />
      </label>

      <div className="space-y-3">
        <label className="flex min-h-[56px] cursor-pointer items-center justify-between gap-4">
          <span>
            <span className="block text-lg font-bold">Share my phone number with my group</span>
            <span className="block text-base text-slate-600">Only the people playing in a game with you see it.</span>
          </span>
          <input
            type="checkbox"
            checked={board.me.sharePhone}
            disabled={busy}
            onChange={(e) =>
              save(
                { share_phone: e.target.checked, phone },
                e.target.checked ? 'Your group will see your phone number.' : "Your phone number won't be shared.",
              )
            }
            className="h-8 w-8 shrink-0 accent-emerald-700"
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Your phone number"
            maxLength={30}
            className={selectCls}
          />
          <button onClick={() => save({ phone }, 'Phone number saved.')} disabled={busy} className={`${secondaryBtn} sm:w-40`}>
            Save
          </button>
        </div>
      </div>
    </section>
  );
}

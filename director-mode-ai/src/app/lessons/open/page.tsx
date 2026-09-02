'use client';

/**
 * /lessons/open — the instructor's setup screen for Open Lesson Time.
 *
 * Written as four numbered steps with the two magic strings on screen and a
 * copy button on each, because every failure of this feature is one of two
 * things: a calendar that was never shared, or an event titled something other
 * than "Open Lesson Time". Both are solved by putting the exact text in front
 * of the instructor rather than in a help page nobody opens.
 *
 * The "Check my calendar now" button is the proof step. It reports what it
 * found in plain numbers ("4 open blocks · 9.5 hours"), so an instructor knows
 * it worked without having to send a client to the page to find out.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CalendarCheck,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';

const INPUT: React.CSSProperties = { color: '#0f172a', backgroundColor: '#ffffff' };
const LENGTHS = [30, 60, 90];

type Settings = {
  slug: string;
  calendar_kind: 'google' | 'ics';
  ics_url: string | null;
  google_calendar_id: string | null;
  open_page_enabled: boolean;
  open_page_note: string | null;
  open_rate_note: string | null;
  open_durations: number[];
  booking_lead_hours: number;
  timezone: string;
  open_synced_at: string | null;
};

type Payload = {
  /** Every club this instructor belongs to — for the switcher when there are several. */
  my_clubs: { id: string; name: string; role: string; role_label: string }[];
  /** Club members set up as instructors but not yet approved. Owner only. */
  pending_instructors: { user_id: string; name: string; email: string | null; connected: boolean }[];
  settings: Settings;
  setup: { share_with: string | null; event_title: string; allowed_durations: number[] };
  club: {
    id: string;
    name: string;
    slug: string;
    enabled: boolean;
    note: string | null;
    is_owner: boolean;
    my_role: string | null;
    my_role_label: string | null;
    can_list: boolean;
    invite_url: string | null;
    url: string;
    instructors_ready: number;
    instructors_total: number;
  } | null;
  my_url: string;
  /** The real Google error, when the calendar could not be read. */
  sync_error: string | null;
  open_windows: number;
  open_hours: number;
  booked_count: number;
};

export default function OpenLessonTimePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState('');
  const [icsUrl, setIcsUrl] = useState('');
  const [kind, setKind] = useState<'google' | 'ics'>('google');
  const [rateNote, setRateNote] = useState('');
  const [pageNote, setPageNote] = useState('');
  const [lead, setLead] = useState('3');
  const [durations, setDurations] = useState<number[]>(LENGTHS);

  const load = useCallback(async () => {
    const res = await fetch('/api/lessons/open/settings', { cache: 'no-store' });
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not load your settings.');
      setLoading(false);
      return;
    }
    const j = (await res.json()) as Payload;
    setData(j);
    setCalendarId(j.settings.google_calendar_id || '');
    setIcsUrl(j.settings.ics_url || '');
    setKind(j.settings.calendar_kind === 'ics' ? 'ics' : 'google');
    setRateNote(j.settings.open_rate_note || '');
    setPageNote(j.settings.open_page_note || '');
    setLead(String(j.settings.booking_lead_hours ?? 3));
    setDurations(j.settings.open_durations || LENGTHS);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (patch: Record<string, unknown>, note?: string) => {
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await fetch('/api/lessons/open/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    setSaving(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not save that.');
      return;
    }
    if (note) setMsg(note);
    await load();
  };

  const promote = async (userId: string, name: string) => {
    setSaving(true);
    setErr(null);
    const res = await fetch('/api/lessons/open/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'promote', user_id: userId }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not add them.');
      return;
    }
    setMsg(`${name} is now a coach at your club — their open times will show on the club page.`);
    await load();
  };

  const sync = async () => {
    setSyncing(true);
    setErr(null);
    setMsg(null);
    const res = await fetch('/api/lessons/open/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync' }),
    });
    const j = await res.json().catch(() => ({}));
    setSyncing(false);
    if (!res.ok) {
      setErr(j.error || 'Could not read your calendar.');
      return;
    }
    setMsg(
      j.windows
        ? `Found ${j.windows} open block${j.windows === 1 ? '' : 's'} · ${j.hours} hours bookable.`
        : `Connected — but no events titled "${data?.setup.event_title}" in the next 45 days yet. Add one and check again.`,
    );
    await load();
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <p className="flex items-center gap-2 text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </p>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-red-600 lg:p-8">{err}</div>;
  }

  const connected =
    data.settings.calendar_kind === 'ics'
      ? !!data.settings.ics_url
      : !!data.settings.google_calendar_id;
  const live = connected && data.settings.open_page_enabled && !data.sync_error;

  return (
    <div className="p-5 lg:p-8">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-slate-900">Open Lesson Time</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
          Block out time on your own Google Calendar and clients book it themselves. You never enter
          anything twice: your calendar is the schedule, and a booking writes straight back to it.
        </p>

        {/* The reason it isn't working, in Google's own words, at the top. */}
        {data.sync_error && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-[14px] leading-relaxed text-red-900">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <span>
              <strong className="block">Your calendar can&apos;t be read yet</strong>
              {data.sync_error}
            </span>
          </div>
        )}

        {/* Status strip — is this on or not, in one line. */}
        <div
          className={`mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border p-4 text-[14px] ${
            live ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          {live ? <CalendarCheck size={17} /> : <AlertTriangle size={17} />}
          <span className="font-semibold">
            {live ? 'Live — clients can book' : connected ? 'Connected, but your page is off' : 'Not set up yet'}
          </span>
          {connected && (
            <>
              <span>{data.open_hours} hours open</span>
              <span>{data.booked_count} lesson{data.booked_count === 1 ? '' : 's'} booked</span>
              {data.settings.open_synced_at && (
                <span className="text-[13px] opacity-70">
                  checked{' '}
                  {new Date(data.settings.open_synced_at).toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: data.settings.timezone,
                  })}
                </span>
              )}
            </>
          )}
        </div>

        {/* Which calendar are we talking to? Everything in steps 1 and 2 changes
            with the answer, so it is asked before either of them. */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-[16px] font-semibold text-slate-900">Which calendar do you use?</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              onClick={() => { setKind('google'); save({ calendar_kind: 'google' }, 'Set up for Google Calendar.'); }}
              className={`rounded-xl border p-4 text-left transition-colors ${
                kind === 'google' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="block text-[15px] font-semibold">Google Calendar</span>
              <span className={`mt-1 block text-[13px] leading-snug ${kind === 'google' ? 'text-white/70' : 'text-slate-500'}`}>
                Bookings write themselves onto your calendar, instantly. Recommended.
              </span>
            </button>
            <button
              onClick={() => { setKind('ics'); save({ calendar_kind: 'ics' }, 'Set up for Apple / iCloud.'); }}
              className={`rounded-xl border p-4 text-left transition-colors ${
                kind === 'ics' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 hover:border-slate-500'
              }`}
            >
              <span className="block text-[15px] font-semibold">Apple / iCloud, Outlook, other</span>
              <span className={`mt-1 block text-[13px] leading-snug ${kind === 'ics' ? 'text-white/70' : 'text-slate-500'}`}>
                We read your published calendar link. Bookings arrive as a one-tap invite by email.
              </span>
            </button>
          </div>
        </div>

        {kind === 'ics' ? (
          <>
            <Step n={1} title="Publish your calendar and copy the link">
              <p className="text-[14.5px] leading-relaxed text-slate-600">
                Apple will not let another app write to iCloud without your Apple ID password, and we
                are not going to ask you for that. Instead you publish a read-only link.
              </p>
              <p className="mt-3 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                On a Mac
              </p>
              <ol className="mt-1.5 space-y-1.5 text-[14px] leading-relaxed text-slate-600">
                <li>1. Open the <strong>Calendar</strong> app.</li>
                <li>2. Right-click the calendar you teach out of in the left column, then <strong>Share Calendar…</strong></li>
                <li>3. Tick <strong>Public Calendar</strong>.</li>
                <li>4. Click the <strong>share icon</strong> next to the link, then <strong>Copy Link</strong>.</li>
              </ol>
              <p className="mt-3 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                On an iPhone
              </p>
              <ol className="mt-1.5 space-y-1.5 text-[14px] leading-relaxed text-slate-600">
                <li>1. Open <strong>Calendar</strong>, then <strong>Calendars</strong> at the bottom.</li>
                <li>2. Tap the <strong>i</strong> next to your calendar.</li>
                <li>3. Turn on <strong>Public Calendar</strong>, then <strong>Share Link…</strong> and <strong>Copy</strong>.</li>
              </ol>
              <p className="mt-3 rounded-lg bg-amber-50 p-3 text-[13.5px] leading-relaxed text-amber-900">
                Two honest caveats. A public link shows the titles and times on that calendar to
                anyone who has it, so publish a calendar you are comfortable sharing — many coaches
                make a separate &ldquo;Lessons&rdquo; calendar for exactly this. And Apple refreshes a
                published link on its own schedule, so a block you add can take up to ~15 minutes to
                show up here. Google&apos;s path is instant and two-way.
              </p>
            </Step>

            <Step n={2} title="Paste the link here">
              <div className="mt-1 flex flex-wrap gap-2">
                <input
                  value={icsUrl}
                  onChange={(e) => setIcsUrl(e.target.value)}
                  placeholder="webcal://p1-caldav.icloud.com/published/2/…"
                  style={INPUT}
                  className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
                />
                <button
                  onClick={() => save({ ics_url: icsUrl, calendar_kind: 'ics' }, 'Calendar link saved.')}
                  disabled={saving || !icsUrl.trim()}
                  className="rounded-lg bg-slate-900 px-5 py-2.5 text-[14.5px] font-semibold text-white disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={sync}
                  disabled={syncing || !connected}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-[14.5px] font-medium text-slate-700 hover:border-slate-500 disabled:opacity-40"
                >
                  {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Check my calendar now
                </button>
              </div>
              <p className="mt-2 text-[13px] text-slate-500">
                Paste it exactly as copied — a <code>webcal://</code> link is fine, we convert it.
              </p>
            </Step>
          </>
        ) : (
          <>
        {/* ---------------------------------------------------------- step 1 */}
        <Step n={1} title="Share your calendar with the booking service">
          <p className="text-[14.5px] leading-relaxed text-slate-600">
            This is what lets ClubMode see your open times and write bookings back. It only ever
            touches events titled <strong>{data.setup.event_title}</strong> and lessons it books
            itself.
          </p>
          <CopyRow label="Share with this address" value={data.setup.share_with || '—'} />
          <ol className="mt-3 space-y-1.5 text-[14px] leading-relaxed text-slate-600">
            <li>
              1. Open{' '}
              <a
                href="https://calendar.google.com/calendar/r/settings"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-blue-700 underline"
              >
                Google Calendar settings <ExternalLink size={12} />
              </a>
            </li>
            <li>2. In the left column, click the calendar you teach out of.</li>
            <li>
              3. Scroll to <strong>Share with specific people or groups</strong> → <strong>Add people</strong>.
            </li>
            <li>4. Paste the address above.</li>
            <li>
              5. Set permissions to <strong>Make changes to events</strong> — anything less and
              bookings can&apos;t be written back.
            </li>
            <li>6. Click <strong>Send</strong>.</li>
          </ol>
        </Step>

        {/* ---------------------------------------------------------- step 2 */}
        <Step n={2} title="Tell us which calendar is yours">
          <p className="text-[14.5px] leading-relaxed text-slate-600">
            Almost always the email address you use for Google Calendar. (A separate coaching
            calendar works too — its ID is at the bottom of that calendar&apos;s settings page.)
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              placeholder="you@gmail.com"
              style={INPUT}
              className="min-w-[16rem] flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
            />
            <button
              onClick={() => save({ google_calendar_id: calendarId }, 'Calendar saved.')}
              disabled={saving || !calendarId.trim()}
              className="rounded-lg bg-slate-900 px-5 py-2.5 text-[14.5px] font-semibold text-white disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={sync}
              disabled={syncing || !connected}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2.5 text-[14.5px] font-medium text-slate-700 hover:border-slate-500 disabled:opacity-40"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Check my calendar now
            </button>
          </div>
        </Step>
          </>
        )}

        {/* ---------------------------------------------------------- step 3 */}
        <Step n={3} title="Block out time you want to fill">
          <p className="text-[14.5px] leading-relaxed text-slate-600">
            On your calendar, create an event titled <strong>exactly</strong> this — nothing before
            it, nothing after it:
          </p>
          <CopyRow label="Event title" value={data.setup.event_title} big />
          <div className="mt-3 rounded-lg bg-slate-50 p-3.5 text-[14px] leading-relaxed text-slate-600">
            <p className="font-semibold text-slate-800">How long you block is what clients can book:</p>
            <ul className="mt-2 space-y-1">
              <li>
                <strong>1 hour open</strong> → someone can book 30 or 60 minutes.
              </li>
              <li>
                <strong>3 hours open</strong> → 30, 60 or 90 minutes, and the rest stays bookable.
              </li>
              <li>
                <strong>30 minutes open</strong> → 30 minutes only.
              </li>
            </ul>
            <p className="mt-2.5">
              {kind === 'ics'
                ? 'Repeat the event weekly and it keeps working. Delete it or rename it and it stops being bookable — that is how you take time back. When someone books, the time comes off your booking page straight away and the lesson arrives by email as a one-tap invite.'
                : "Book a 60 out of a 3-hour block and your calendar splits itself: the lesson goes in under the client's name and the leftover time stays open. Repeat the event weekly and it keeps working. Delete it or rename it and it stops being bookable — that is how you take time back."}
            </p>
          </div>
        </Step>

        {/* ---------------------------------------------------------- step 4 */}
        <Step n={4} title="Turn on your booking page and share the link">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() =>
                save(
                  { open_page_enabled: !data.settings.open_page_enabled },
                  data.settings.open_page_enabled ? 'Booking page turned off.' : 'Booking page is live.',
                )
              }
              disabled={saving || !connected}
              className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-40 ${
                data.settings.open_page_enabled ? 'bg-emerald-500' : 'bg-slate-300'
              }`}
              aria-label="Toggle booking page"
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                  data.settings.open_page_enabled ? 'left-6' : 'left-1'
                }`}
              />
            </button>
            <span className="text-[14.5px] text-slate-700">
              {data.settings.open_page_enabled ? 'Clients can book your open times' : 'Your times are hidden'}
            </span>
          </div>
          {!connected && (
            <p className="mt-2 text-[13.5px] text-amber-700">Add your calendar in step 2 first.</p>
          )}

          <CopyRow label="Your booking link" value={data.my_url} link />

          {data.club && (
            <div className="mt-4 rounded-lg border border-slate-200 p-4">
              <p className="text-[14.5px] font-semibold text-slate-800">
                {data.club.name} — one page for the whole club
              </p>

              {/* Teaching at more than one club: say which one this page is for
                  rather than silently picking. */}
              {data.my_clubs?.length > 1 && (
                <label className="mt-2 block">
                  <span className="text-[12.5px] text-slate-600">
                    You&apos;re at {data.my_clubs.length} clubs. This booking page belongs to:
                  </span>
                  <select
                    value={data.club.id || ''}
                    onChange={(e) => save({ club_id: e.target.value }, 'Moved to that club.')}
                    disabled={saving}
                    style={INPUT}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-slate-500"
                  >
                    {data.my_clubs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.role_label})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="mt-1 text-[14px] leading-relaxed text-slate-600">
                {data.club.instructors_ready} of {data.club.instructors_total} instructor
                {data.club.instructors_total === 1 ? '' : 's'} set up. Clients pick a length, then see
                every instructor&apos;s open times together.
              </p>

              {/* Whether THIS person will actually appear there. */}
              <p
                className={`mt-2 rounded-lg p-2.5 text-[13.5px] leading-relaxed ${
                  data.club.can_list ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'
                }`}
              >
                {data.club.can_list ? (
                  <>You&apos;re listed as an instructor at {data.club.name}, so your open times show on the club page.</>
                ) : (
                  <>
                    You&apos;re at {data.club.name} as a{' '}
                    <strong>{data.club.my_role_label || 'member'}</strong>, and the club page lists
                    coaches only. Ask your director to make you a Coach and your times appear there
                    automatically. Your own booking link below works either way.
                  </>
                )}
              </p>

              {/* One tap, from the page the director is already on. */}
              {data.club.is_owner && data.pending_instructors?.length > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-[13px] font-semibold text-amber-900">
                    Waiting for you to add them as a coach
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-amber-800">
                    They&apos;ve joined the club and started setting up. Until you add them, their
                    times can&apos;t show on the club page.
                  </p>
                  <div className="mt-2 space-y-1.5">
                    {data.pending_instructors.map((p) => (
                      <div
                        key={p.user_id}
                        className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2"
                      >
                        <span className="text-[14px] font-medium text-slate-900">{p.name}</span>
                        {p.email && <span className="text-[12.5px] text-slate-500">{p.email}</span>}
                        <span
                          className={`text-[12px] ${p.connected ? 'text-emerald-700' : 'text-slate-400'}`}
                        >
                          {p.connected ? 'calendar connected' : 'no calendar yet'}
                        </span>
                        <button
                          onClick={() => promote(p.user_id, p.name)}
                          disabled={saving}
                          className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
                        >
                          Make coach
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.club.invite_url && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-[13px] font-semibold text-slate-800">Adding another instructor</p>
                  <ol className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-slate-600">
                    <li>1. They create a free ClubMode account and open the link below to join the club.</li>
                    <li>
                      2. They appear right here for you to <strong>Make coach</strong> in one tap —
                      the join link only ever grants Member, because coach is a staff role.
                    </li>
                    <li>3. They open this page and connect their own calendar.</li>
                  </ol>
                  <CopyRow label="Club join link" value={data.club.invite_url} link />
                </div>
              )}
              {data.club.is_owner ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() =>
                      save(
                        { club_enabled: !data.club!.enabled },
                        data.club!.enabled ? 'Club page turned off.' : 'Club page is live.',
                      )
                    }
                    disabled={saving}
                    className={`relative h-7 w-12 rounded-full transition-colors ${
                      data.club.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                    aria-label="Toggle club booking page"
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${
                        data.club.enabled ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                  <span className="text-[14px] text-slate-700">
                    {data.club.enabled ? 'Club booking page is live' : 'Club booking page is off'}
                  </span>
                </div>
              ) : (
                <p className="mt-2 text-[13.5px] text-slate-500">
                  {data.club.enabled
                    ? 'The club page is live — your times appear on it as soon as your own page is on.'
                    : 'Ask your director to turn the club page on.'}
                </p>
              )}
              <CopyRow label="Club booking link" value={data.club.url} link />
            </div>
          )}
        </Step>

        {/* ------------------------------------------------------- preferences */}
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-[16px] font-semibold text-slate-900">Your rules</h2>

          <p className="mt-4 text-[13px] font-semibold uppercase tracking-wider text-slate-500">
            Lesson lengths you offer
          </p>
          <div className="mt-2 flex gap-2">
            {LENGTHS.map((d) => {
              const on = durations.includes(d);
              return (
                <button
                  key={d}
                  onClick={() => {
                    const next = on ? durations.filter((x) => x !== d) : [...durations, d].sort((a, b) => a - b);
                    setDurations(next.length ? next : LENGTHS);
                    save({ open_durations: next.length ? next : LENGTHS });
                  }}
                  className={`rounded-xl border px-4 py-2.5 text-[14.5px] font-semibold transition-colors ${
                    on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 text-slate-600'
                  }`}
                >
                  {d} min
                </button>
              );
            })}
          </div>
          <p className="mt-1.5 text-[13px] text-slate-500">
            A length is only offered when it actually fits the time you blocked out.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                Notice needed (hours)
              </span>
              <input
                value={lead}
                onChange={(e) => setLead(e.target.value)}
                onBlur={() => save({ booking_lead_hours: Number(lead) })}
                inputMode="numeric"
                style={INPUT}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
              />
              <span className="mt-1 block text-[12.5px] text-slate-500">
                Nothing starting sooner than this can be booked.
              </span>
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
                Rate note (shown on the page)
              </span>
              <input
                value={rateNote}
                onChange={(e) => setRateNote(e.target.value)}
                onBlur={() => save({ open_rate_note: rateNote })}
                placeholder="$95/hr · billed to your club account"
                style={INPUT}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] outline-none focus:border-slate-500"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="text-[13px] font-semibold uppercase tracking-wider text-slate-500">
              Welcome line on your page
            </span>
            <textarea
              value={pageNote}
              onChange={(e) => setPageNote(e.target.value)}
              onBlur={() => save({ open_page_note: pageNote })}
              rows={2}
              placeholder="Grab a time that works — courts are at the club, bring a can of balls."
              style={INPUT}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-slate-500"
            />
          </label>
        </div>

        {msg && (
          <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-[14px] text-emerald-800">{msg}</p>
        )}
        {err && <p className="mt-4 rounded-xl bg-red-50 p-3 text-[14px] text-red-700">{err}</p>}
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[13px] font-bold text-white">
          {n}
        </span>
        <h2 className="text-[16px] font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** A string the instructor has to copy exactly — so give them the button. */
function CopyRow({
  label,
  value,
  big,
  link,
}: {
  label: string;
  value: string;
  big?: boolean;
  link?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3">
      <p className="text-[12.5px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2.5">
        <Calendar size={15} className="shrink-0 text-slate-400" />
        <code className={`min-w-0 flex-1 truncate ${big ? 'text-[16px] font-semibold' : 'text-[14px]'} text-slate-800`}>
          {value}
        </code>
        {link && (
          <a href={value} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-slate-900">
            <ExternalLink size={15} />
          </a>
        )}
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-slate-700 hover:border-slate-500"
        >
          {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

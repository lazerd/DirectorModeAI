'use client';

/**
 * QR check-in, for the director and the front desk.
 *
 * Findings first (what the check-ins say), then what is happening right now
 * with the one staff override that matters — clearing a court someone forgot
 * to finish — then setup: the rules, and the signs.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Finding } from '@/lib/checkin/insights';
import type { SettingsRow, SpaceRow } from '@/lib/checkin/server';
import type { CourtCard } from '@/lib/checkin/views';

type StaffData = {
  club: { id: string; name: string; slug: string; timezone: string; isPublic: boolean };
  role: string;
  appUrl: string;
  settings: SettingsRow;
  spaces: (SpaceRow & { url: string })[];
  live: {
    courts: (CourtCard & { sessionId: string | null; fullNames: string | null })[];
    waits: { id: string; names: string; playType: string; status: string; joinedAt: string; offeredSpace: string | null; offerExpiresAt: string | null; email: string | null }[];
    pools: { id: string; name: string; headcount: number; capacity: number | null }[];
  };
  today: { id: string; space: string; kind: string; playType: string; names: string; members: number; guestCount: number; guestNames: string[]; startedAt: string; endedAt: string | null; endReason: string | null; status: string }[];
  findings: Finding[];
};

const inputStyle: React.CSSProperties = { color: '#0f172a', backgroundColor: '#fff' };
const panel = 'rounded-2xl border border-white/10 bg-[#002838] p-5';

const STATE_LABEL: Record<string, string> = {
  free: 'Free',
  playing: 'In play',
  overtime: 'Over time',
  held: 'Held for wait list',
  blocked: 'Booked',
  closed: 'Closed',
};

export default function CheckinManager() {
  const [data, setData] = useState<StaffData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<SettingsRow | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [newSpace, setNewSpace] = useState({ kind: 'pool', name: 'Pool', capacity: '' });

  const load = useCallback(async () => {
    const res = await fetch('/api/checkin/staff', { cache: 'no-store' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(j.error || 'Could not load check-in.');
      return;
    }
    setData(j);
    setDraft((d) => d ?? j.settings);
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function post(body: Record<string, unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/checkin/staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) setError(j.error || 'That did not save.');
      else {
        if (ok) setNotice(ok);
        await load();
      }
      return res.ok;
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="text-red-300">{error}</p>;
  if (!data || !draft) return <p className="text-white/50">Loading…</p>;

  const tz = data.club.timezone;
  const t = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '';
  const canManage = data.role === 'owner' || data.role === 'director';
  const courts = data.spaces.filter((s) => s.kind === 'court');
  const others = data.spaces.filter((s) => s.kind !== 'court');
  const poolToday = data.today.filter((x) => x.kind !== 'court');
  const guestsToday = poolToday.reduce((n, x) => n + x.guestCount, 0);

  const num = (key: keyof SettingsRow, label: string, suffix = 'min') => (
    <label className="block">
      <span className="text-sm text-white/60">{label}</span>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="number"
          className="w-24 rounded-lg px-3 py-2"
          style={inputStyle}
          value={String(draft[key] ?? '')}
          disabled={!canManage}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value === '' ? null : Number(e.target.value) })}
        />
        <span className="text-sm text-white/50">{suffix}</span>
      </div>
    </label>
  );
  const toggle = (key: keyof SettingsRow, label: string, help?: string) => (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="mt-1 h-5 w-5"
        checked={!!draft[key]}
        disabled={!canManage}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
      />
      <span>
        <span className="text-white">{label}</span>
        {help ? <span className="block text-sm text-white/50">{help}</span> : null}
      </span>
    </label>
  );

  return (
    <div className="space-y-6 text-white">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">QR check-in</h1>
          <p className="mt-1 max-w-xl text-white/60">
            A QR sign on every court replaces the paper register. Players scan to start their time, join the wait list when it is busy, and see when a court is theirs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/run/checkin/signs" className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-[#001820]">
            Print signs
          </Link>
          {data.club.isPublic ? (
            <a href={`/checkin/${data.club.slug}/board`} target="_blank" rel="noreferrer" className="rounded-xl border border-white/20 px-4 py-2 font-semibold">
              Court board
            </a>
          ) : null}
        </div>
      </header>

      {error ? <p className="rounded-xl bg-red-500/15 p-3 text-red-200">{error}</p> : null}
      {notice ? <p className="rounded-xl bg-emerald-500/15 p-3 text-emerald-200">{notice}</p> : null}

      {/* ------------------------------------------------------- findings */}
      <section className={panel}>
        <h2 className="text-lg font-semibold">What the check-ins say</h2>
        {data.findings.length ? (
          <ul className="mt-3 space-y-4">
            {data.findings.map((f) => (
              <li key={f.key}>
                <div className="text-lg font-semibold text-cyan-200">{f.headline}</div>
                <div className="text-sm text-white/60">{f.detail}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-white/60">
            Not enough check-ins yet. After about a week of play this is where you will see which courts are full in prime time and which sit empty, the worst hour to be waiting, and pool guest visits for billing.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <a className="text-cyan-300 underline" href="/api/checkin/staff/export?days=90">Download check-ins (CSV, 90 days)</a>
          <a className="text-cyan-300 underline" href="/api/checkin/staff/export?days=90&type=waits">Download wait list history (CSV)</a>
        </div>
      </section>

      {/* ------------------------------------------------------ right now */}
      <section className={panel}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Right now</h2>
          <span className="text-sm text-white/50">
            {data.live.waits.filter((w) => w.status === 'waiting').length} waiting
          </span>
        </div>
        {courts.length === 0 ? (
          <p className="mt-2 text-white/60">
            No courts yet. Add your courts in{' '}
            <Link className="text-cyan-300 underline" href="/courtsheet/staff">
              CourtSheet
            </Link>{' '}
            and they get signs here automatically.
          </p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {data.live.courts.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {c.name} <span className="text-sm font-normal text-white/50">· {STATE_LABEL[c.state]}</span>
                  </div>
                  <div className="truncate text-sm text-white/60">
                    {c.fullNames ? `${c.fullNames} · ${c.playType}${c.until ? ` · until ${t(c.until)}` : ''}` : null}
                    {c.state === 'held' ? `${c.heldFor} · by ${t(c.heldUntil)}` : null}
                    {c.state === 'blocked' ? `${c.blockLabel} until ${t(c.until)}` : null}
                  </div>
                </div>
                {c.sessionId ? (
                  <button
                    disabled={busy}
                    onClick={() => post({ action: 'clear_session', session_id: c.sessionId }, `${c.name} cleared.`)}
                    className="shrink-0 rounded-lg border border-white/20 px-3 py-1.5 text-sm hover:bg-white/10"
                  >
                    Clear court
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {data.live.waits.length ? (
          <div className="mt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-white/50">Wait list</h3>
            <ol className="mt-2 space-y-2">
              {data.live.waits.map((w) => (
                <li key={w.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-2">
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold">{w.names}</span>{' '}
                    <span className="text-white/50">
                      · {w.playType} · since {t(w.joinedAt)}
                      {w.status === 'offered' ? ` · offered ${w.offeredSpace} until ${t(w.offerExpiresAt)}` : ''}
                    </span>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => post({ action: 'remove_wait', wait_id: w.id }, 'Removed from the wait list.')}
                    className="shrink-0 rounded-lg border border-white/20 px-3 py-1 text-sm hover:bg-white/10"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {data.live.pools.length ? (
          <div className="mt-4 flex flex-wrap gap-3">
            {data.live.pools.map((p) => (
              <div key={p.id} className="rounded-xl bg-white/5 px-4 py-3">
                <div className="text-sm text-white/60">{p.name} now</div>
                <div className="text-2xl font-bold">
                  {p.headcount}
                  {p.capacity ? <span className="text-base text-white/50"> / {p.capacity}</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      {/* ---------------------------------------------------------- today */}
      <section className={panel}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Today</h2>
          <span className="text-sm text-white/50">
            {data.today.length} check-ins{poolToday.length ? ` · ${guestsToday} pool guests` : ''}
          </span>
        </div>
        {data.today.length === 0 ? (
          <p className="mt-2 text-white/60">No one has checked in today.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-white/50">
                <tr>
                  <th className="py-1 pr-3">Time</th>
                  <th className="py-1 pr-3">Where</th>
                  <th className="py-1 pr-3">Who</th>
                  <th className="py-1 pr-3">Guests</th>
                  <th className="py-1">Ended</th>
                </tr>
              </thead>
              <tbody>
                {data.today.map((x) => (
                  <tr key={x.id} className="border-t border-white/5 align-top">
                    <td className="py-2 pr-3 whitespace-nowrap">{t(x.startedAt)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{x.space}</td>
                    <td className="py-2 pr-3">
                      {x.names}
                      {x.members ? <span className="ml-1 text-xs text-emerald-300">member</span> : null}
                    </td>
                    <td className="py-2 pr-3">{x.guestCount ? `${x.guestCount}${x.guestNames.length ? ` (${x.guestNames.join(', ')})` : ''}` : ''}</td>
                    <td className="py-2 whitespace-nowrap text-white/60">{x.status === 'active' ? 'on now' : `${t(x.endedAt)} · ${x.endReason}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- rules */}
      <section className={panel}>
        <h2 className="text-lg font-semibold">Rules</h2>
        <p className="mt-1 text-sm text-white/50">
          The defaults are a typical court register: singles 1 hour, doubles 1½ hours, only when others are waiting, two players present.
          {canManage ? '' : ' Only an owner or director can change them.'}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {num('singles_minutes', 'Singles')}
          {num('doubles_minutes', 'Doubles')}
          {num('other_minutes', 'Ball machine / other')}
          {num('min_players', 'Players to sign in', 'people')}
          {num('grace_minutes', 'Finish-the-point grace')}
          {num('claim_minutes', 'Time to claim an offered court')}
          {num('max_session_minutes', 'Longest session, nobody waiting')}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {toggle('enabled', 'Check-in is on', 'Off pauses every sign and the board.')}
          {toggle('limits_only_when_waiting', 'Limits apply only when others are waiting')}
          {toggle('mirror_to_courtsheet', 'Show walk-on play on the CourtSheet grid', 'Writes a block for each session so the staff grid shows it.')}
          {toggle('geofence_enabled', 'Players must be at the club', 'Asks the phone for its location. Off by default.')}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <label className="block">
            <span className="text-sm text-white/60">Prime time starts</span>
            <input type="time" className="mt-1 w-full rounded-lg px-3 py-2" style={inputStyle} value={draft.prime_start} disabled={!canManage} onChange={(e) => setDraft({ ...draft, prime_start: e.target.value })} />
          </label>
          <label className="block">
            <span className="text-sm text-white/60">Prime time ends</span>
            <input type="time" className="mt-1 w-full rounded-lg px-3 py-2" style={inputStyle} value={draft.prime_end} disabled={!canManage} onChange={(e) => setDraft({ ...draft, prime_end: e.target.value })} />
          </label>
          {draft.geofence_enabled ? (
            <>
              <label className="block">
                <span className="text-sm text-white/60">Club latitude</span>
                <input className="mt-1 w-full rounded-lg px-3 py-2" style={inputStyle} value={draft.latitude ?? ''} disabled={!canManage} onChange={(e) => setDraft({ ...draft, latitude: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="text-sm text-white/60">Club longitude</span>
                <input className="mt-1 w-full rounded-lg px-3 py-2" style={inputStyle} value={draft.longitude ?? ''} disabled={!canManage} onChange={(e) => setDraft({ ...draft, longitude: e.target.value === '' ? null : Number(e.target.value) })} />
              </label>
              {num('geofence_meters', 'Allowed distance', 'metres')}
            </>
          ) : null}
        </div>
        {canManage ? (
          <button
            disabled={busy}
            onClick={() => post({ action: 'update_settings', settings: draft }, 'Rules saved.')}
            className="mt-5 rounded-xl bg-cyan-400 px-5 py-2 font-semibold text-[#001820] disabled:opacity-50"
          >
            Save rules
          </button>
        ) : null}
      </section>

      {/* --------------------------------------------------- signs/spaces */}
      <section className={panel}>
        <h2 className="text-lg font-semibold">Signs</h2>
        <p className="mt-1 text-sm text-white/50">
          One sign per court, one wait-list sign for the complex, and one for each gate. “New QR” retires a sign: the old printout stops working, so reprint it.
        </p>
        <div className="mt-3 divide-y divide-white/5">
          {[...others.filter((s) => s.kind === 'kiosk'), ...courts, ...others.filter((s) => s.kind !== 'kiosk')].map((s) => (
            <div key={s.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">
                    {s.name} <span className="text-sm font-normal text-white/50">· {s.kind === 'kiosk' ? 'wait list' : s.kind}</span>
                    {!s.active ? <span className="ml-2 text-xs text-amber-300">off</span> : null}
                  </div>
                  <a href={`/q/${s.token}`} target="_blank" rel="noreferrer" className="text-sm text-cyan-300 underline">
                    {s.url.replace(/^https?:\/\//, '')}
                  </a>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link href={`/run/checkin/signs?space=${s.id}`} className="rounded-lg border border-white/20 px-3 py-1.5 hover:bg-white/10">
                    Print
                  </Link>
                  {canManage ? (
                    <>
                      {s.kind !== 'kiosk' ? (
                        <button onClick={() => setEditing(editing === s.id ? null : s.id)} className="rounded-lg border border-white/20 px-3 py-1.5 hover:bg-white/10">
                          {editing === s.id ? 'Close' : 'Rules'}
                        </button>
                      ) : null}
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Make a new QR for ${s.name}? The sign printed now will stop working.`)) {
                            post({ action: 'rotate_token', space_id: s.id }, `${s.name} has a new QR. Reprint its sign.`);
                          }
                        }}
                        className="rounded-lg border border-white/20 px-3 py-1.5 hover:bg-white/10"
                      >
                        New QR
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {editing === s.id ? <SpaceEditor space={s} busy={busy} onSave={(patch) => post({ action: 'update_space', space_id: s.id, patch }, `${s.name} saved.`)} /> : null}
            </div>
          ))}
        </div>

        {canManage ? (
          <div className="mt-4 rounded-xl bg-white/5 p-4">
            <div className="font-semibold">Add a gate or space</div>
            <p className="text-sm text-white/50">A pool gate, lap lanes, the fitness room — anything people sign in to, with an optional headcount limit.</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-sm text-white/60">Kind</span>
                <select className="mt-1 block rounded-lg px-3 py-2" style={inputStyle} value={newSpace.kind} onChange={(e) => setNewSpace({ ...newSpace, kind: e.target.value })}>
                  <option value="pool">Pool</option>
                  <option value="room">Room</option>
                  <option value="other">Other</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm text-white/60">Name</span>
                <input className="mt-1 block rounded-lg px-3 py-2" style={inputStyle} value={newSpace.name} onChange={(e) => setNewSpace({ ...newSpace, name: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-sm text-white/60">Capacity</span>
                <input type="number" className="mt-1 block w-28 rounded-lg px-3 py-2" style={inputStyle} value={newSpace.capacity} onChange={(e) => setNewSpace({ ...newSpace, capacity: e.target.value })} />
              </label>
              <button
                disabled={busy}
                onClick={async () => {
                  if (await post({ action: 'add_space', kind: newSpace.kind, name: newSpace.name, capacity: newSpace.capacity || undefined }, `${newSpace.name} added.`)) {
                    setNewSpace({ kind: 'pool', name: '', capacity: '' });
                  }
                }}
                className="rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-[#001820] disabled:opacity-50"
              >
                Add
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SpaceEditor({ space, busy, onSave }: { space: SpaceRow; busy: boolean; onSave: (patch: Record<string, unknown>) => void }) {
  const [p, setP] = useState({
    name: space.name,
    active: space.active,
    singles_minutes: space.singles_minutes ?? '',
    doubles_minutes: space.doubles_minutes ?? '',
    other_minutes: space.other_minutes ?? '',
    min_players: space.min_players ?? '',
    capacity: space.capacity ?? '',
    track_guests: space.track_guests,
    guest_names_required: space.guest_names_required,
  });
  const field = (key: keyof typeof p, label: string) => (
    <label className="block">
      <span className="text-xs text-white/60">{label}</span>
      <input
        type="number"
        placeholder="club rule"
        className="mt-1 w-24 rounded-lg px-2 py-1.5"
        style={inputStyle}
        value={String(p[key])}
        onChange={(e) => setP({ ...p, [key]: e.target.value })}
      />
    </label>
  );
  const isCourt = space.kind === 'court';
  return (
    <div className="mt-3 rounded-xl bg-white/5 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs text-white/60">Name on the sign</span>
          <input className="mt-1 block rounded-lg px-2 py-1.5" style={inputStyle} value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
        </label>
        {isCourt ? (
          <>
            {field('singles_minutes', 'Singles')}
            {field('doubles_minutes', 'Doubles')}
            {field('other_minutes', 'Other')}
            {field('min_players', 'Players')}
          </>
        ) : (
          field('capacity', 'Capacity')
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={p.active} onChange={(e) => setP({ ...p, active: e.target.checked })} /> Sign is on
        </label>
        {!isCourt ? (
          <>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.track_guests} onChange={(e) => setP({ ...p, track_guests: e.target.checked })} /> Ask about guests
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={p.guest_names_required} onChange={(e) => setP({ ...p, guest_names_required: e.target.checked })} /> Guest names required
            </label>
          </>
        ) : null}
      </div>
      <button
        disabled={busy}
        onClick={() =>
          onSave({
            ...p,
            singles_minutes: p.singles_minutes === '' ? null : p.singles_minutes,
            doubles_minutes: p.doubles_minutes === '' ? null : p.doubles_minutes,
            other_minutes: p.other_minutes === '' ? null : p.other_minutes,
            min_players: p.min_players === '' ? null : p.min_players,
            capacity: p.capacity === '' ? null : p.capacity,
          })
        }
        className="mt-3 rounded-lg bg-cyan-400 px-4 py-1.5 text-sm font-semibold text-[#001820] disabled:opacity-50"
      >
        Save
      </button>
      {isCourt ? <p className="mt-2 text-xs text-white/40">Leave a box empty to use the club rule. A ball-machine court might allow 1 player.</p> : null}
    </div>
  );
}

'use client';

/**
 * Rain-out makeup poll. The other club offers a few makeup dates; this asks the
 * players who were in the lineup first (Yes / No on every date), then — once
 * the captain is ready — the rest of the roster. Tally updates live below.
 */

import { useCallback, useEffect, useState } from 'react';
import EmailPreviewModal, { type EmailPreview } from './EmailPreviewModal';
import { isoToZonedWallTime, zonedWallTimeToIso } from '@/lib/captain/clubTime';

type Row = {
  id: string;
  name: string;
  email: string | null;
  in_lineup: boolean;
  votes: Record<string, 'yes' | 'no'>;
};
type Poll = {
  id: string;
  options: { at: string }[];
  note: string | null;
  lineup_sent_at: string | null;
  rest_sent_at: string | null;
};
type Audience = 'lineup' | 'rest';

export default function MakeupPollPanel({
  teamId,
  matchId,
  matchAt,
  timeZone,
}: {
  teamId: string;
  matchId: string;
  matchAt: string;
  timeZone: string;
}) {
  const [poll, setPoll] = useState<Poll | null>(null);
  const [players, setPlayers] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [dates, setDates] = useState<string[]>(['', '']);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [pending, setPending] = useState<Audience>('lineup');

  const load = useCallback(async () => {
    const res = await fetch(`/api/captain/makeup?team_id=${teamId}&match_id=${matchId}`);
    if (!res.ok) return;
    const json = (await res.json()) as { poll: Poll | null; players: Row[] };
    setPoll(json.poll);
    setPlayers(json.players);
    if (json.poll) {
      setOpen(true);
      setDates(json.poll.options.map((o) => isoToZonedWallTime(o.at, timeZone)));
      setNote(json.poll.note || '');
    }
  }, [teamId, matchId, timeZone]);

  useEffect(() => {
    void load();
  }, [load]);

  // Default a new makeup date to the original match's start time.
  const originalTime = isoToZonedWallTime(matchAt, timeZone).slice(11, 16);
  const isos = dates.map((d) => zonedWallTimeToIso(d, timeZone)).filter((d): d is string => !!d);
  const locked = !!poll && players.some((p) => Object.keys(p.votes).length > 0);

  async function post(audience: Audience, isPreview: boolean) {
    const res = await fetch('/api/captain/makeup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, match_id: matchId, options: isos, note, audience, preview: isPreview }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Could not send.');
    return json;
  }

  async function requestPreview(audience: Audience) {
    if (isos.length < 1) return setError('Enter at least one makeup date and time.');
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const json = await post(audience, true);
      if (!json.count) {
        setMsg('Nobody to send to.');
        return;
      }
      setPending(audience);
      setPreview(json as EmailPreview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    setBusy(true);
    setError(null);
    try {
      const json = await post(pending, false);
      setMsg(`Sent to ${json.sent} ${pending === 'lineup' ? 'lineup players' : 'other players'}.`);
      setPreview(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  const lineup = players.filter((p) => p.in_lineup);
  const rest = players.filter((p) => !p.in_lineup);
  const day = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone }).format(new Date(iso));
  const shown = poll ? poll.options.map((o) => o.at) : isos;

  const btn = 'px-4 py-2 rounded-xl font-semibold text-sm disabled:opacity-50';

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-sm px-4 py-2 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25"
      >
        🌧 Rained out? Poll the team on makeup dates
      </button>
    );
  }

  const Tally = ({ group, title }: { group: Row[]; title: string }) => (
    <div className="mt-4">
      <div className="text-xs uppercase tracking-wider text-white/40 mb-2">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-white/50">
              <th className="text-left font-normal py-1 pr-3">Player</th>
              {shown.map((iso, i) => (
                <th key={i} className="text-center font-normal py-1 px-2 whitespace-nowrap">
                  {day(iso)}
                  <div className="text-[#D3FB52]">{group.filter((p) => p.votes[i] === 'yes').length} yes</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.map((p) => (
              <tr key={p.id} className="border-t border-white/5">
                <td className="py-1.5 pr-3 text-white/80">{p.name}</td>
                {shown.map((_, i) => (
                  <td key={i} className="text-center py-1.5 px-2">
                    {p.votes[i] === 'yes' ? (
                      <span className="text-green-400">✓</span>
                    ) : p.votes[i] === 'no' ? (
                      <span className="text-red-400">✗</span>
                    ) : (
                      <span className="text-white/20">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <EmailPreviewModal preview={preview} sending={busy} onSend={confirmSend} onCancel={() => setPreview(null)} />
      <h2 className="text-lg font-display text-white">🌧 Rain-out makeup poll</h2>
      <p className="text-sm text-white/50 mt-1">
        Enter the makeup dates offered. The lineup gets first call with Yes / No on each date; then send it to everyone else.
      </p>

      <div className="mt-4 space-y-2">
        {dates.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-white/50 text-sm w-20">Option {i + 1}</span>
            <input
              type="date"
              value={d.slice(0, 10)}
              disabled={locked}
              onChange={(e) =>
                setDates((all) => all.map((x, j) => (j === i ? `${e.target.value}T${x.slice(11, 16) || originalTime}` : x)))
              }
              className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white text-sm"
            />
            <input
              type="time"
              value={d.slice(11, 16) || originalTime}
              disabled={locked}
              onChange={(e) =>
                setDates((all) => all.map((x, j) => (j === i && x.slice(0, 10) ? `${x.slice(0, 10)}T${e.target.value}` : x)))
              }
              className="rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white text-sm"
            />
            {!locked && dates.length > 1 && (
              <button onClick={() => setDates((all) => all.filter((_, j) => j !== i))} className="text-white/40 hover:text-white text-sm">
                remove
              </button>
            )}
          </div>
        ))}
        {!locked && dates.length < 4 && (
          <button onClick={() => setDates((all) => [...all, ''])} className="text-sm text-white/50 hover:text-white">
            + add a date
          </button>
        )}
        {locked && <p className="text-xs text-white/40">Dates are locked — players have started answering.</p>}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note at the top of the email (e.g. OCC prefers Thursday)"
        rows={2}
        className="mt-3 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-white text-sm"
      />

      {msg && <p className="text-sm text-[#D3FB52] mt-3">{msg}</p>}
      {error && <p className="text-sm text-red-300 mt-3">{error}</p>}

      <div className="mt-4 flex flex-wrap gap-3">
        <button onClick={() => requestPreview('lineup')} disabled={busy} className={`${btn} bg-[#D3FB52] text-[#001820]`}>
          {poll?.lineup_sent_at ? 'Resend to lineup' : `1 · Preview & send to lineup (${lineup.length})`}
        </button>
        <button
          onClick={() => requestPreview('rest')}
          disabled={busy || !poll?.lineup_sent_at}
          title={poll?.lineup_sent_at ? '' : 'Send to the lineup first'}
          className={`${btn} border border-white/15 text-white`}
        >
          {poll?.rest_sent_at ? 'Resend to everyone else' : `2 · Preview & send to everyone else (${rest.filter((p) => p.email).length})`}
        </button>
      </div>
      {poll?.lineup_sent_at && (
        <p className="text-xs text-white/40 mt-2">
          Lineup sent {new Date(poll.lineup_sent_at).toLocaleString('en-US', { timeZone })}
          {poll.rest_sent_at ? ` · everyone else sent ${new Date(poll.rest_sent_at).toLocaleString('en-US', { timeZone })}` : ''}
        </p>
      )}

      {shown.length > 0 && poll && (
        <>
          <Tally group={lineup} title="Lineup (first call)" />
          {poll.rest_sent_at && <Tally group={rest} title="Everyone else" />}
        </>
      )}
    </section>
  );
}

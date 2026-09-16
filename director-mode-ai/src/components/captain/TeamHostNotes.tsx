'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

/**
 * Host-club emails waiting on the team hub, plus the team's forwarding address.
 *
 * A forwarded email that named its date lands on the right match by itself and
 * links there for review. One that couldn't be placed asks which match it is
 * about — filing venue details on the wrong week sends players to the wrong club.
 */

type Note = {
  id: string;
  match_id: string | null;
  from_email: string | null;
  subject: string | null;
  created_at: string;
  extracted: { host_club: string | null; match_date: string | null };
};
type MatchOpt = { id: string; match_at: string; opponent: string | null; is_home: boolean };

export default function TeamHostNotes({ teamId, timeZone }: { teamId: string; timeZone: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [matches, setMatches] = useState<MatchOpt[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/captain/host-note?team_id=${teamId}`);
    if (!res.ok) return;
    const j = (await res.json()) as { notes: Note[]; matches: MatchOpt[]; address: string };
    setNotes(j.notes);
    setMatches(j.matches);
    setAddress(j.address);
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const when = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));

  const patch = async (note: Note, action: 'assign' | 'dismiss') => {
    setBusy(note.id);
    await fetch('/api/captain/host-note', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, note_id: note.id, action, match_id: pick[note.id] }),
    });
    setBusy(null);
    load();
  };

  return (
    <section className="mt-6 rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
      <div className="text-white font-medium">Emails from host clubs</div>
      {address && (
        <p className="text-white/50 text-sm mt-1">
          Forward a host club&apos;s &ldquo;looking forward to hosting you&rdquo; email to{' '}
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="text-[#D3FB52] underline underline-offset-2"
            title="Copy"
          >
            {address}
          </button>
          {copied ? ' (copied)' : ''}. ClubMode reads the warm-up, check-in and parking details and files them
          on that match for you to check. Nothing reaches your players until you apply it.
        </p>
      )}

      {notes.length > 0 && (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => {
            const m = matches.find((x) => x.id === n.match_id);
            return (
              <li key={n.id} className="rounded-lg border border-[#D3FB52]/25 bg-[#001820] p-3 text-sm">
                <div className="text-white">
                  {n.subject || 'Host email'}
                  <span className="text-white/40">{n.from_email ? ` · ${n.from_email}` : ''}</span>
                </div>
                {m ? (
                  <Link
                    href={`/captain/${teamId}/match/${m.id}`}
                    className="inline-block mt-2 text-[#D3FB52] underline underline-offset-2"
                  >
                    Review for {when(m.match_at)} {m.is_home ? 'vs' : 'at'} {m.opponent} →
                  </Link>
                ) : (
                  <div className="mt-2 flex gap-2 flex-wrap items-center">
                    <span className="text-amber-200">Which match is this about?</span>
                    <select
                      value={pick[n.id] ?? ''}
                      onChange={(e) => setPick((p) => ({ ...p, [n.id]: e.target.value }))}
                      style={{ color: '#ffffff', backgroundColor: '#001820' }}
                      className="px-2 py-1.5 rounded-lg border border-white/10 text-sm"
                    >
                      <option value="">Choose…</option>
                      {matches.map((x) => (
                        <option key={x.id} value={x.id}>
                          {when(x.match_at)} {x.is_home ? 'vs' : 'at'} {x.opponent}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => patch(n, 'assign')}
                      disabled={!pick[n.id] || busy === n.id}
                      className="px-3 py-1.5 rounded-lg bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
                    >
                      File it
                    </button>
                  </div>
                )}
                <button
                  onClick={() => patch(n, 'dismiss')}
                  disabled={busy === n.id}
                  className="ml-0 mt-2 block text-xs text-white/40 hover:text-red-300"
                >
                  Dismiss
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

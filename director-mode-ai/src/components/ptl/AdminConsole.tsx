'use client';

/**
 * The commissioner's controls.
 *
 * Two jobs, and the second one is the one that actually gets used on the night:
 *
 *   Run the draft — start, pause, resume, undo. Every draft that has ever run
 *   needed at least one of these: a captain's phone dies, someone taps the
 *   wrong name, the room needs five minutes. Without an undo the only repair is
 *   editing the database by hand while eleven people wait.
 *
 *   Hand out the captain links — one per team, each one a credential. This is
 *   the fiddly, error-prone job (twelve links, twelve different people, and
 *   sending Bayside's link to Redline's captain means Redline can draft as
 *   Bayside), so the links are copied one at a time from a button next to the
 *   team's own name rather than assembled by hand from a list.
 */

import { useState } from 'react';
import { toast } from 'sonner';

type Team = {
  id: string;
  name: string;
  shortCode: string;
  draftSlot: number | null;
  captainName: string | null;
  captainEmail: string | null;
  token: string;
  rosterCount: number;
};

type Props = {
  draftId: string | null;
  status: string | null;
  currentPickNo: number | null;
  picksMade: number;
  totalPicks: number;
  onClockTeamId: string | null;
  seasonSlug: string;
  teams: Team[];
  origin: string;
};

export default function AdminConsole({
  draftId,
  status,
  currentPickNo,
  picksMade,
  totalPicks,
  onClockTeamId,
  seasonSlug,
  teams,
  origin,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function act(action: 'start' | 'pause' | 'resume' | 'undo' | 'invite-captains') {
    if (!draftId) return;
    // The only destructive one. A misfired undo during a live draft silently
    // takes a player back off a roster, so it asks.
    if (action === 'undo' && !confirm('Undo the last pick? The player goes back in the pool and that team is back on the clock.')) {
      return;
    }
    setBusy(action);
    try {
      const res = await fetch('/api/ptl/admin/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, action }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error || 'That did not work.');
        return;
      }
      if (action === 'invite-captains') {
        toast.success(
          body.notice
            || `Sent to ${body.sent} captain${body.sent === 1 ? '' : 's'}`
              + (body.skipped ? `, ${body.skipped} skipped (no email on file)` : '.'),
        );
        return; // nothing on screen changed, so don't reload out from under them
      }
      toast.success(
        action === 'undo' ? 'Last pick undone.' : action === 'pause' ? 'Draft paused.' : 'Draft running.',
      );
      // The controls read from server state, so a reload is the honest refresh.
      window.location.reload();
    } catch {
      toast.error('Lost the connection.');
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(team: Team) {
    const url = `${origin}/ptl/draft/${team.token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(team.id);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard is blocked on insecure origins and in some browsers; showing
      // the link is more useful than an error nobody can act on.
      toast.message(url);
    }
  }

  const live = status === 'live';

  return (
    <div className="space-y-10">
      {/* ---------- draft controls ---------- */}
      <section className="rounded-sm border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-black tracking-tight">Draft</h2>
          <p className="text-sm text-white/50">
            {draftId ? (
              <>
                <span className="capitalize text-white/75">{status}</span>
                {' · '}
                {picksMade} of {totalPicks} picks
                {currentPickNo && <> · on pick {currentPickNo}</>}
              </>
            ) : (
              'No draft set up for this season yet.'
            )}
          </p>
        </div>

        {draftId && (
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              onClick={() => act(live ? 'pause' : status === 'complete' ? 'start' : 'start')}
              disabled={!!busy || status === 'complete'}
              className="rounded-sm bg-teal-400 px-5 py-2.5 text-sm font-bold text-[#06231F] transition-colors hover:bg-teal-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/35"
            >
              {busy ? '…' : live ? 'Pause draft' : status === 'paused' ? 'Resume draft' : 'Start draft'}
            </button>
            <button
              onClick={() => act('undo')}
              disabled={!!busy || picksMade === 0}
              className="rounded-sm border border-white/25 px-5 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white disabled:cursor-not-allowed disabled:border-white/10 disabled:text-white/30"
            >
              Undo last pick
            </button>
            <button
              onClick={() => {
                const missing = teams.filter((t) => !t.captainEmail).length;
                const warning = missing
                  ? `

${missing} team${missing === 1 ? ' has' : 's have'} no captain email and will be skipped.`
                  : '';
                if (confirm(`Email all ${teams.length} captains their draft link?${warning}`)) {
                  act('invite-captains');
                }
              }}
              disabled={!!busy}
              className="rounded-sm border border-white/25 px-5 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white disabled:border-white/10 disabled:text-white/30"
            >
              {busy === 'invite-captains' ? 'Sending…' : 'Email captains their links'}
            </button>
            <a
              href={`/ptl/draft/board?season=${seasonSlug}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-white/25 px-5 py-2.5 text-sm font-semibold text-white/85 transition-colors hover:border-white/50 hover:text-white"
            >
              Open the board ↗
            </a>
          </div>
        )}

        {status === 'paused' && (
          <p className="mt-4 text-sm text-amber-300/90">
            Paused. Nobody&rsquo;s clock is running, so no auto-picks can fire while you sort
            things out.
          </p>
        )}
      </section>

      {/* ---------- captains ---------- */}
      <section>
        <h2 className="text-xl font-black tracking-tight">Captains</h2>
        <p className="mt-1 text-sm text-white/50">
          Each link is that captain&rsquo;s credential — anyone holding it can draft as that team.
          Send them one at a time.
        </p>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-white/15 text-[11px] uppercase tracking-[0.14em] text-white/40">
                <th className="pb-2.5 font-medium">Slot</th>
                <th className="pb-2.5 font-medium">Team</th>
                <th className="pb-2.5 font-medium">Captain</th>
                <th className="pb-2.5 text-right font-medium">Roster</th>
                <th className="pb-2.5 text-right font-medium">Draft link</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr
                  key={t.id}
                  className={`border-b border-white/[0.07] ${t.id === onClockTeamId ? 'bg-teal-400/[0.06]' : ''}`}
                >
                  <td className="py-3 text-sm tabular-nums text-white/45">{t.draftSlot ?? '—'}</td>
                  <td className="py-3">
                    <span className="font-bold">{t.name}</span>
                    {t.id === onClockTeamId && (
                      <span className="ml-2.5 text-[10px] font-bold uppercase tracking-wider text-teal-300">
                        on the clock
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-sm text-white/65">
                    {t.captainName || <span className="text-white/30">Not set</span>}
                    {t.captainEmail && (
                      <span className="block text-xs text-white/35">{t.captainEmail}</span>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums text-white/60">{t.rosterCount}</td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => copyLink(t)}
                      className="rounded-sm border border-white/20 px-3 py-1.5 text-xs text-white/70 transition-colors hover:border-white/45 hover:text-white"
                    >
                      {copied === t.id ? 'Copied' : 'Copy link'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

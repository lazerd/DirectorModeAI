'use client';

import { useMemo, useState } from 'react';
import {
  Loader2,
  Send,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  XCircle,
  Ban,
  Tag,
} from 'lucide-react';
import {
  parseDivisions,
  planQuadAllocation,
  computeQuadCapacity,
  PLAYERS_PER_QUAD,
  formatDeadline,
} from '@/lib/quadDivisions';
import { createClient } from '@/lib/supabase/client';
import type { QuadEvent, QuadEntry } from '../QuadsAdminDashboard';

/** Positions still competing for a spot. */
const LIVE = ['requested', 'pending_payment', 'in_flight'];

export default function QuadsAllocationPanel({
  event,
  entries,
  onRefresh,
}: {
  event: QuadEvent;
  entries: QuadEntry[];
  onRefresh: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = createClient();
  const divisions = useMemo(() => parseDivisions(event.divisions), [event.divisions]);
  const totalQuads = event.total_quads ?? divisions.length;
  const capacity = computeQuadCapacity({
    totalQuads,
    maxTotalQuads: event.max_total_quads,
    numCourts: event.num_courts,
    hasWave2: !!(event.wave2_start_time && event.wave2_end_time),
  });
  const feeLabel = `$${((event.entry_fee_cents ?? 0) / 100).toFixed(0)}`;

  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  // The plan only considers players still in the running — expired and
  // withdrawn entries have given their spot back.
  const plan = useMemo(
    () =>
      planQuadAllocation({
        divisions,
        entries: entries
          .filter((e) => LIVE.includes(e.position))
          .map((e) => ({
            id: e.id,
            division: e.division,
            registered_at: e.registered_at,
          })),
        totalQuads,
      }),
    [divisions, entries, totalQuads]
  );

  const now = Date.now();
  const overdue = entries.filter(
    (e) =>
      e.position === 'pending_payment' &&
      e.payment_status !== 'paid' &&
      e.payment_status !== 'waived' &&
      e.payment_due_at !== null &&
      Date.parse(e.payment_due_at) < now
  );

  // Accepted players who haven't been invited yet — the actual send list.
  const uninvited = plan.perDivision.flatMap((d) =>
    d.acceptedIds.filter((id) => {
      const entry = entryById.get(id);
      return entry && entry.position === 'requested';
    })
  );

  const waitingTotal = plan.perDivision.reduce((n, d) => n + d.waitlistIds.length, 0);

  const setQuads = async (next: number) => {
    const clamped = Math.max(1, Math.min(capacity.maxQuads, next));
    if (clamped === totalQuads) return;
    if (
      clamped > totalQuads &&
      !confirm(
        `Open a ${clamped}${clamped === 2 ? 'nd' : clamped === 3 ? 'rd' : 'th'} quad?

` +
          `That's ${clamped * PLAYERS_PER_QUAD} spots and needs two more courts. Make sure the ` +
          `court time actually exists before you invite anyone into it.`
      )
    )
      return;
    setBusy('capacity');
    setError(null);
    setMessage(null);
    const { error: err } = await supabase
      .from('events')
      .update({ total_quads: clamped })
      .eq('id', event.id);
    if (err) setError(err.message);
    else setMessage(`Now running ${clamped} quad${clamped === 1 ? '' : 's'} — ${clamped * PLAYERS_PER_QUAD} spots.`);
    await onRefresh();
    setBusy(null);
  };

  const sendInvites = async (entryIds: string[], label: string) => {
    if (entryIds.length === 0) return;
    if (
      !confirm(
        `Send a ${feeLabel} payment link to ${entryIds.length} player${entryIds.length === 1 ? '' : 's'} (${label})?\n\n` +
          `Each gets 24 hours to pay. Their spot is only confirmed once Square reports the payment.`
      )
    )
      return;
    setBusy('invite');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/quads/events/${event.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry_ids: entryIds, hours: 24 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send invites.');
      } else {
        setMessage(
          `Sent ${data.sent} payment link${data.sent === 1 ? '' : 's'}${
            data.failed ? ` · ${data.failed} failed` : ''
          }. Deadline: ${data.deadline_label}.`
        );
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    }
    await onRefresh();
    setBusy(null);
  };

  const releaseOverdue = async () => {
    if (
      !confirm(
        `Release ${overdue.length} expired hold${overdue.length === 1 ? '' : 's'} and email those players?\n\n` +
          `Anyone who has actually paid is skipped automatically.`
      )
    )
      return;
    setBusy('expire');
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/quads/events/${event.id}/expire-invites`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || 'Could not release holds.');
      else setMessage(`Released ${data.expired} spot${data.expired === 1 ? '' : 's'}.`);
    } catch (err: any) {
      setError(err?.message || 'Network error');
    }
    await onRefresh();
    setBusy(null);
  };

  if (divisions.length === 0) return null;

  return (
    <div className="bg-white border-2 border-orange-200 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold text-lg flex items-center gap-2">
            <Users size={18} className="text-orange-500" />
            Divisions &amp; invitations
          </h3>
          <p className="text-sm text-gray-600 mt-0.5">
            {totalQuads} quad{totalQuads === 1 ? '' : 's'} of {PLAYERS_PER_QUAD} in this block.
            First four in a division get the spots; a division short of four gives its block to
            whoever has the most players waiting.
          </p>
        </div>
        {uninvited.length > 0 && (
          <button
            onClick={() => sendInvites(uninvited, 'all divisions')}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg font-semibold text-sm disabled:opacity-50 flex-shrink-0"
          >
            {busy === 'invite' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Send size={14} />
            )}
            Send {uninvited.length} payment link{uninvited.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {/* Capacity is a DIRECTOR decision, never automatic — opening a quad
          means finding two more courts, which the app can't know about. */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-gray-50 border border-gray-200 rounded-lg p-3">
        <div className="text-sm">
          <span className="font-semibold text-gray-900">
            {totalQuads} quad{totalQuads === 1 ? '' : 's'} open · {totalQuads * PLAYERS_PER_QUAD}{' '}
            spots
          </span>
          <div className="text-xs text-gray-600 mt-0.5">
            {waitingTotal > 0
              ? `${waitingTotal} on the waitlist across all divisions.`
              : 'Nobody waiting yet.'}
            {capacity.canGrow
              ? ` You could go to ${capacity.maxQuads} — needs ${capacity.quadsPerWave * 2} courts per session.`
              : ' At the ceiling for the courts and sessions on this event.'}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setQuads(totalQuads - 1)}
            disabled={busy !== null || totalQuads <= 1}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-white disabled:opacity-40"
          >
            − Close one
          </button>
          <button
            onClick={() => setQuads(totalQuads + 1)}
            disabled={busy !== null || !capacity.canGrow}
            title={capacity.canGrow ? 'Only do this once you have the courts' : 'No room left'}
            className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40 bg-gray-800 hover:bg-gray-900"
          >
            + Open another quad
          </button>
        </div>
      </div>

      {message && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3 text-sm">
          {message}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {overdue.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm text-amber-900">
            <span className="font-semibold flex items-center gap-1.5">
              <AlertTriangle size={14} />
              {overdue.length} hold{overdue.length === 1 ? '' : 's'} past the 24-hour deadline
            </span>
            <span className="text-xs">
              {overdue.map((e) => e.player_name).join(', ')}
            </span>
          </div>
          <button
            onClick={releaseOverdue}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {busy === 'expire' ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
            Release &amp; notify
          </button>
        </div>
      )}

      {plan.orphanIds.length > 0 && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {plan.orphanIds.length} entr{plan.orphanIds.length === 1 ? 'y has' : 'ies have'} no valid
          division and won&rsquo;t be allocated — fix them in the table below.
        </div>
      )}

      <div className="space-y-3">
        {plan.perDivision.map((d) => {
          const division = divisions.find((x) => x.id === d.divisionId)!;
          const accepted = d.acceptedIds.map((id) => entryById.get(id)!).filter(Boolean);
          const waiting = d.waitlistIds.map((id) => entryById.get(id)!).filter(Boolean);
          const toInvite = accepted.filter((x) => x.position === 'requested');

          return (
            <div
              key={d.divisionId}
              className={`rounded-xl border p-3 ${
                d.viable ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900">{division.label}</span>
                  {d.viable ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                      {d.quads} quad{d.quads === 1 ? '' : 's'} · {accepted.length} in
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600 font-medium">
                      {d.totalRequests < PLAYERS_PER_QUAD
                        ? `Won't run — only ${d.totalRequests} signed up`
                        : "Won't run — no block left"}
                    </span>
                  )}
                </div>
                {toInvite.length > 0 && (
                  <button
                    onClick={() => sendInvites(toInvite.map((x) => x.id), division.label)}
                    disabled={busy !== null}
                    className="text-xs font-semibold px-3 py-1.5 border border-orange-300 text-orange-700 rounded-lg hover:bg-orange-50 disabled:opacity-50"
                  >
                    Invite {toInvite.length}
                  </button>
                )}
              </div>

              {accepted.length === 0 && waiting.length === 0 ? (
                <p className="text-xs text-gray-500 italic">No signups yet.</p>
              ) : (
                <ol className="space-y-1">
                  {accepted.map((entry, i) => (
                    <EntryRow key={entry.id} entry={entry} index={i + 1} seated />
                  ))}
                  {waiting.map((entry, i) => (
                    <EntryRow
                      key={entry.id}
                      entry={entry}
                      index={accepted.length + i + 1}
                      seated={false}
                    />
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>

      {plan.unusedQuads > 0 && (
        <p className="text-xs text-gray-500">
          {plan.unusedQuads} of {totalQuads} court blocks unused — not enough players to fill
          another quad.
        </p>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  index,
  seated,
}: {
  entry: QuadEntry;
  index: number;
  seated: boolean;
}) {
  const paid = entry.payment_status === 'paid' || entry.payment_status === 'waived';
  const awaiting = entry.position === 'pending_payment' && !paid;
  const overdue =
    awaiting && entry.payment_due_at !== null && Date.parse(entry.payment_due_at) < Date.now();

  return (
    <li
      className={`flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg ${
        seated ? 'bg-gray-50' : 'opacity-60'
      }`}
    >
      <span className="w-5 text-xs font-mono text-gray-400">{index}.</span>
      <span className="flex-1 truncate text-gray-900">{entry.player_name}</span>

      {entry.coupon_code && (
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 flex items-center gap-1"
          title={`Code ${entry.coupon_code}`}
        >
          <Tag size={9} />
          {entry.discount_percent === 100 ? 'COMP' : `${entry.discount_percent}% OFF`}
        </span>
      )}

      {entry.position === 'expired' ? (
        <span className="text-xs text-red-600 font-medium flex items-center gap-1">
          <XCircle size={12} /> expired
        </span>
      ) : paid ? (
        <span className="text-xs text-emerald-700 font-medium flex items-center gap-1">
          <CheckCircle2 size={12} /> paid
        </span>
      ) : awaiting ? (
        <span
          className={`text-xs font-medium flex items-center gap-1 ${
            overdue ? 'text-red-600' : 'text-amber-600'
          }`}
          title={entry.payment_due_at ? formatDeadline(entry.payment_due_at) : undefined}
        >
          <Clock size={12} />
          {overdue ? 'overdue' : 'awaiting payment'}
        </span>
      ) : seated ? (
        <span className="text-xs text-gray-500">not invited yet</span>
      ) : (
        <span className="text-xs text-gray-500">waitlist</span>
      )}
    </li>
  );
}

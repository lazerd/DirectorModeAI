'use client';

/**
 * Detail drawer — opens when you click an existing block.
 *
 * Surfaces:
 *   - Reservation summary (title, court, time, source)
 *   - Signup roster + capacity controls
 *   - Cancel / open-or-close signups / edit title
 */

import { useEffect, useMemo, useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { X, Users, Trash2, ExternalLink, Check, UserMinus } from 'lucide-react';
import type { Reservation, Signup } from '@/lib/courtsheet/types';
import { utcToLocalTime } from '@/lib/courtsheet/timezones';
import { blockStyleFor, sourceLabel } from '@/lib/courtsheet/theme';

interface Props {
  open: boolean;
  onClose: () => void;
  reservation: Reservation | null;
  timezone: string;
  onPatched: (r: Reservation) => void;
  onCancelled: () => void;
}

interface DetailResponse {
  reservation: Reservation;
  signups: Signup[];
}

export default function ReservationDrawer({
  open,
  onClose,
  reservation,
  timezone,
  onPatched,
  onCancelled,
}: Props) {
  const [signups, setSignups] = useState<Signup[]>([]);
  const [loading, setLoading] = useState(false);
  const [r, setR] = useState<Reservation | null>(reservation);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(reservation?.title ?? '');

  useEffect(() => {
    setR(reservation);
    setTitleDraft(reservation?.title ?? '');
    if (reservation && open) loadDetails(reservation.id);
  }, [reservation, open]);

  async function loadDetails(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/courtsheet/reservations/${id}`, {
        cache: 'no-store',
      });
      const data = (await res.json()) as DetailResponse;
      setR(data.reservation);
      setSignups(data.signups);
    } finally {
      setLoading(false);
    }
  }

  if (!r) return null;
  const style = blockStyleFor(r.type, r.color);
  const startLocal = utcToLocalTime(r.starts_at, timezone);
  const endLocal = utcToLocalTime(r.ends_at, timezone);

  const activeSignups = signups.filter((s) => s.status !== 'cancelled');
  const confirmed = activeSignups.filter((s) => s.status !== 'waitlist');
  const waitlist = activeSignups.filter((s) => s.status === 'waitlist');

  async function patch(body: Record<string, unknown>) {
    const res = await fetch(`/api/courtsheet/reservations/${r!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const { reservation: next } = await res.json();
      setR(next);
      onPatched(next);
    }
  }

  async function cancel() {
    if (!confirm('Cancel this reservation? Signups will be cancelled too.')) return;
    const res = await fetch(`/api/courtsheet/reservations/${r!.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      onCancelled();
      onClose();
    }
  }

  async function toggleSignups() {
    if (!r) return;
    await patch({
      signups_open: !r.signups_open,
      signups_capacity: r.signups_open ? null : (r.signups_capacity ?? 4),
    });
  }

  async function cancelSignup(s: Signup) {
    await fetch(`/api/courtsheet/reservations/${r!.id}/signups?signup_id=${s.id}`, {
      method: 'DELETE',
    });
    await loadDetails(r!.id);
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="bg-[#001820] border-t border-white/10 text-white">
        <DrawerHeader className="text-left">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: style.hex }}
              />
              {editingTitle ? (
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    if (titleDraft.trim() && titleDraft !== r.title) patch({ title: titleDraft.trim() });
                    setEditingTitle(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') {
                      setTitleDraft(r.title);
                      setEditingTitle(false);
                    }
                  }}
                  className="bg-white/[0.05] border border-white/10 rounded-lg px-2 py-1 text-base font-semibold text-white"
                />
              ) : (
                <DrawerTitle
                  className="text-white cursor-text"
                  onClick={() => setEditingTitle(true)}
                >
                  {r.title}
                </DrawerTitle>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60"
            >
              <X size={16} />
            </button>
          </div>
          <DrawerDescription className="text-white/50 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="tabular-nums">{startLocal} – {endLocal}</span>
            <span className="text-white/20">·</span>
            <span className="text-[10px] uppercase tracking-widest" style={{ color: style.hex }}>
              {sourceLabel(r.source)} {r.type}
            </span>
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-4">
          {/* Signups section */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={14} className="text-[#D3FB52]" />
                <div className="text-sm font-medium">
                  Signups
                  {r.signups_open && (
                    <span className="ml-2 text-xs text-white/50 tabular-nums">
                      {confirmed.length}
                      {r.signups_capacity ? ` / ${r.signups_capacity}` : ''}
                      {waitlist.length > 0 ? ` (+${waitlist.length} waitlist)` : ''}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={toggleSignups}
                className={[
                  'px-3 py-1 rounded-full text-[11px] font-semibold uppercase tracking-widest border transition',
                  r.signups_open
                    ? 'bg-[#D3FB52]/15 text-[#D3FB52] border-[#D3FB52]/30'
                    : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10',
                ].join(' ')}
              >
                {r.signups_open ? 'Open' : 'Closed'}
              </button>
            </div>

            {r.signups_open && (
              <>
                {r.signups_pitch && (
                  <div className="text-xs text-white/60 italic">"{r.signups_pitch}"</div>
                )}
                {loading ? (
                  <div className="cs-shimmer h-6 rounded-lg" />
                ) : confirmed.length === 0 && waitlist.length === 0 ? (
                  <div className="text-xs text-white/40 text-center py-2">
                    No signups yet — share the public link to invite players.
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {[...confirmed, ...waitlist].map((s) => (
                      <li
                        key={s.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={[
                              'inline-block w-1.5 h-1.5 rounded-full',
                              s.status === 'waitlist' ? 'bg-white/30' : 'bg-emerald-400',
                            ].join(' ')}
                          />
                          <span className="text-sm truncate">
                            {s.guest_name ?? s.user_id ?? s.vault_player_id ?? '—'}
                          </span>
                          {s.status === 'waitlist' && (
                            <span className="text-[9px] uppercase tracking-widest text-white/40">
                              waitlist
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => cancelSignup(s)}
                          className="h-7 w-7 rounded-lg text-white/40 hover:text-white hover:bg-white/10 flex items-center justify-center"
                          aria-label="Remove signup"
                          title="Remove signup"
                        >
                          <UserMinus size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          {/* Footer actions */}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={cancel}
              className="flex-1 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-sm font-medium flex items-center justify-center gap-2"
            >
              <Trash2 size={14} />
              Cancel reservation
            </button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

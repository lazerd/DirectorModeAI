'use client';

/**
 * Staff CourtSheet — the orchestrator client component.
 *
 * Holds state (date, filters, reservations) and connects the UI atoms
 * (DateNav, Filters, Sheet, CourtHeaderStrip, QuickCreate, Drawer,
 * CommandDock) to the API routes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Sparkles, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import type { Court, Reservation, Club, BookingIntent } from '@/lib/courtsheet/types';
import { utcToLocalDate } from '@/lib/courtsheet/timezones';
import DateNav from '@/components/courtsheet/DateNav';
import Filters from '@/components/courtsheet/Filters';
import Sheet from '@/components/courtsheet/Sheet';
import CourtHeaderStrip from '@/components/courtsheet/CourtHeaderStrip';
import QuickCreateSheet from '@/components/courtsheet/QuickCreateSheet';
import ReservationDrawer from '@/components/courtsheet/ReservationDrawer';
import CommandDock from '@/components/courtsheet/CommandDock';

interface Props {
  club: Club;
  initialCourts: Court[];
  ownerEmail: string;
}

export default function StaffSheetClient({ club, initialCourts, ownerEmail }: Props) {
  const todayISO = useMemo(() => utcToLocalDate(new Date(), club.timezone), [club.timezone]);
  const [date, setDate] = useState(todayISO);
  const [courts, setCourts] = useState<Court[]>(initialCourts);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [desaturatedSources, setDesaturatedSources] = useState<Set<string>>(new Set());
  const [desaturatedTypes, setDesaturatedTypes] = useState<Set<string>>(new Set());

  const [quickCreate, setQuickCreate] = useState<{
    court: Court;
    timeLocal: string;
  } | null>(null);
  const [openReservationId, setOpenReservationId] = useState<string | null>(null);

  const fetchReservations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/courtsheet/reservations?date=${encodeURIComponent(date)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      setReservations((data.reservations as Reservation[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    fetchReservations();
  }, [fetchReservations]);

  // Light realtime: poll every 25s while tab is visible. Phase 5 will
  // upgrade to supabase.channel subscriptions.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') fetchReservations();
    };
    const id = setInterval(tick, 25_000);
    return () => clearInterval(id);
  }, [fetchReservations]);

  const onBlockMove = useCallback(
    async (
      r: Reservation,
      target: { court_id: string; starts_at: string; ends_at: string }
    ) => {
      // Optimistic update.
      const prev = reservations;
      setReservations((rs) =>
        rs.map((x) => (x.id === r.id ? { ...x, ...target } : x))
      );
      try {
        const planRes = await fetch('/api/courtsheet/reservations/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'mutate',
            mutation: {
              kind: 'move',
              selector: { club_id: club.id, reservation_id: r.id },
              target: { courts: [], date: target.starts_at.slice(0, 10) },
            },
          }),
        });
        const { plan } = await planRes.json();
        if (!plan) throw new Error('No plan');
        // Override toCreate with our snapped target (the engine's move
        // computes its own times; for direct UI moves we override).
        plan.toCreate = [
          {
            ...plan.toCreate?.[0],
            court_id: target.court_id,
            starts_at: target.starts_at,
            ends_at: target.ends_at,
          },
        ];
        const applyRes = await fetch('/api/courtsheet/reservations/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, channel: 'ui' }),
        });
        if (!applyRes.ok) {
          const err = await applyRes.json();
          toast.error(err.error === 'conflicts_block_apply' ? 'Conflict — drop blocked' : 'Move failed');
          setReservations(prev);
        } else {
          toast.success('Moved');
          fetchReservations();
        }
      } catch (err) {
        setReservations(prev);
        toast.error('Move failed');
      }
    },
    [club.id, reservations, fetchReservations]
  );

  const onBlockResize = useCallback(
    async (r: Reservation, ends_at: string) => {
      const prev = reservations;
      setReservations((rs) => rs.map((x) => (x.id === r.id ? { ...x, ends_at } : x)));
      try {
        const res = await fetch(`/api/courtsheet/reservations/${r.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ends_at }),
        });
        // PATCH disallows ends_at — fall back to plan+apply via a thin route.
        if (!res.ok) {
          const planRes = await fetch('/api/courtsheet/reservations/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              kind: 'mutate',
              mutation: {
                kind: 'move',
                selector: { club_id: club.id, reservation_id: r.id },
                target: { date: r.starts_at.slice(0, 10) },
              },
            }),
          });
          const { plan } = await planRes.json();
          if (plan) {
            plan.toCreate = [{ ...plan.toCreate?.[0], ends_at }];
            const applyRes = await fetch('/api/courtsheet/reservations/apply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ plan, channel: 'ui' }),
            });
            if (!applyRes.ok) {
              setReservations(prev);
              toast.error('Resize failed');
            } else {
              toast.success('Resized');
              fetchReservations();
            }
          }
        } else {
          fetchReservations();
        }
      } catch {
        setReservations(prev);
      }
    },
    [club.id, reservations, fetchReservations]
  );

  const onEmptyCellClick = useCallback(
    (court: Court, _date: string, timeLocal: string) => {
      setQuickCreate({ court, timeLocal });
    },
    []
  );

  const submitQuickCreate = useCallback(
    async (intent: BookingIntent) => {
      const planRes = await fetch('/api/courtsheet/reservations/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'book', intent }),
      });
      if (!planRes.ok) {
        toast.error('Could not plan booking');
        return;
      }
      const { plan } = await planRes.json();
      const conflicts = plan?.conflicts ?? [];
      if (conflicts.length > 0) {
        toast.error(`${conflicts.length} conflict${conflicts.length === 1 ? '' : 's'} — adjust time/court`);
        return;
      }
      const applyRes = await fetch('/api/courtsheet/reservations/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, channel: 'ui' }),
      });
      if (!applyRes.ok) {
        const err = await applyRes.json();
        toast.error(err.error ?? 'Booking failed');
        return;
      }
      toast.success('Booked');
      fetchReservations();
    },
    [fetchReservations]
  );

  const toggleSource = useCallback((s: string) => {
    setDesaturatedSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);
  const toggleType = useCallback((t: string) => {
    setDesaturatedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }, []);

  const sharePublic = useCallback(async () => {
    const url = `${window.location.origin}/courtsheet/${club.slug}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: club.name, url });
        return;
      } catch {}
    }
    await navigator.clipboard.writeText(url);
    toast.success('Public link copied');
  }, [club.slug, club.name]);

  return (
    <div className="min-h-screen bg-[#001820] text-white pb-24" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-40 bg-[#001820]/95 backdrop-blur-md border-b border-white/[0.06]">
        <div className="max-w-[1400px] mx-auto px-3 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/" className="h-8 w-8 rounded-xl bg-[#D3FB52]/10 border border-[#D3FB52]/20 flex items-center justify-center shrink-0">
              <LayoutGrid size={14} className="text-[#D3FB52]" />
            </Link>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest text-white/40">CourtSheet AI</div>
              <div className="text-sm font-semibold truncate">{club.name}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={sharePublic}
            className="hidden sm:flex items-center gap-1.5 px-3 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium text-white/80"
            title="Share the public member view"
          >
            <Share2 size={13} />
            Share public view
          </button>
        </div>
        <div className="max-w-[1400px] mx-auto px-3 sm:px-6 pb-3 flex flex-wrap items-center gap-3">
          <DateNav date={date} onChange={setDate} todayISO={todayISO} />
          <div className="hidden sm:block flex-1" />
          <div className="w-full sm:w-auto overflow-x-auto">
            <Filters
              desaturatedSources={desaturatedSources}
              desaturatedTypes={desaturatedTypes}
              onToggleSource={toggleSource}
              onToggleType={toggleType}
            />
          </div>
        </div>
      </div>

      {/* Empty state if no courts */}
      {courts.length === 0 ? (
        <div className="max-w-[1400px] mx-auto px-3 sm:px-6 mt-12">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-10 text-center">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#D3FB52]/10 border border-[#D3FB52]/20 mb-4">
              <Sparkles size={20} className="text-[#D3FB52]" />
            </div>
            <h2 className="text-xl font-semibold mb-2">Add your first court</h2>
            <p className="text-white/50 text-sm max-w-md mx-auto">
              Your sheet is waiting on courts. Run the SQL seed at <code className="text-[#D3FB52]">supabase/migrations/courtsheet_009_seed_sleepy_hollow.sql</code> or
              add courts via the courts API.
            </p>
          </div>
        </div>
      ) : (
        <div className="max-w-[1400px] mx-auto">
          <CourtHeaderStrip
            courts={courts}
            reservations={reservations}
            nowMs={Date.now()}
            isMobile={false}
          />
          <Sheet
            club={{ id: club.id, timezone: club.timezone }}
            courts={courts}
            reservations={reservations}
            desaturatedSources={desaturatedSources}
            desaturatedTypes={desaturatedTypes}
            date={date}
            onBlockClick={(r) => setOpenReservationId(r.id)}
            onEmptyCellClick={onEmptyCellClick}
            onBlockMove={onBlockMove}
            onBlockResize={onBlockResize}
          />
        </div>
      )}

      <CommandDock />

      <QuickCreateSheet
        open={!!quickCreate}
        onClose={() => setQuickCreate(null)}
        court={quickCreate?.court ?? null}
        date={date}
        timeLocal={quickCreate?.timeLocal ?? '09:00'}
        clubId={club.id}
        onSubmit={submitQuickCreate}
      />

      <ReservationDrawer
        open={!!openReservationId}
        onClose={() => setOpenReservationId(null)}
        reservation={reservations.find((r) => r.id === openReservationId) ?? null}
        timezone={club.timezone}
        onPatched={(next) =>
          setReservations((rs) => rs.map((r) => (r.id === next.id ? next : r)))
        }
        onCancelled={() => {
          fetchReservations();
        }}
      />
    </div>
  );
}

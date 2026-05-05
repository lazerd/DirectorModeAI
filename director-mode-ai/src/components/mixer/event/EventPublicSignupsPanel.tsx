'use client';

/**
 * EventPublicSignupsPanel
 *
 * Inline panel injected at the top of /mixer/events/[id] for events that
 * have public_registration=true. Shows the public signups (tournament_entries
 * rows for this event_id) so the director sees who's registered, can
 * promote/demote between confirmed/waitlist, copy the public signup URL,
 * and email scoring links.
 *
 * Future: a "Push to event" button that converts tournament_entries into
 * the legacy event_players rows so the existing mixer UI picks them up.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Copy,
  Check,
  Share2,
  Trash2,
  Users,
  ArrowUp,
  ArrowDown,
  Mail,
  Download,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type EventLite = {
  id: string;
  name: string;
  slug: string | null;
  match_format: string | null;
  public_registration: boolean | null;
  entry_fee_cents: number | null;
  max_players: number | null;
};

type Entry = {
  id: string;
  player_name: string;
  player_email: string | null;
  parent_email: string | null;
  partner_name: string | null;
  ntrp: number | null;
  utr: number | null;
  position: 'pending_payment' | 'in_draw' | 'waitlist' | 'withdrawn';
  payment_status: string;
  notes: string | null;
  imported_at: string | null;
};

const POSITION_LABELS: Record<Entry['position'], { label: string; color: string }> = {
  in_draw: { label: 'Confirmed', color: 'bg-emerald-100 text-emerald-700' },
  waitlist: { label: 'Waitlist', color: 'bg-amber-100 text-amber-700' },
  pending_payment: { label: 'Pending pmt', color: 'bg-gray-100 text-gray-700' },
  withdrawn: { label: 'Withdrawn', color: 'bg-red-100 text-red-700' },
};

export default function EventPublicSignupsPanel({ eventId }: { eventId: string }) {
  const [event, setEvent] = useState<EventLite | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [emailResult, setEmailResult] = useState<{ sent: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ players_created: number; signups_imported: number } | null>(null);

  const fetchAll = useCallback(async () => {
    const supabase = createClient();
    const { data: ev } = await supabase
      .from('events')
      .select('id, name, slug, match_format, public_registration, entry_fee_cents, max_players')
      .eq('id', eventId)
      .maybeSingle();
    setEvent(ev as EventLite);

    const { data: e } = await supabase
      .from('tournament_entries')
      .select(
        'id, player_name, player_email, parent_email, partner_name, ntrp, utr, position, payment_status, notes, imported_at'
      )
      .eq('event_id', eventId)
      .order('registered_at', { ascending: true });
    setEntries((e as Entry[]) || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const publicUrl = useMemo(() => {
    if (!event?.slug) return '';
    if (typeof window === 'undefined') return `/events/${event.slug}`;
    return `${window.location.origin}/events/${event.slug}`;
  }, [event]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* swallow */
    }
  };

  const setPosition = async (entryId: string, position: 'in_draw' | 'waitlist' | 'withdrawn') => {
    setBusy(entryId);
    await fetch(`/api/tournaments/entries/${entryId}/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position }),
    });
    await fetchAll();
    setBusy(null);
  };

  const removeEntry = async (entryId: string) => {
    if (!confirm('Remove this signup permanently?')) return;
    const supabase = createClient();
    await supabase.from('tournament_entries').delete().eq('id', entryId);
    await fetchAll();
  };

  const emailScoringLinks = async () => {
    if (!confirm('Email a personal scoring link to every confirmed player?')) return;
    setEmailing(true);
    setEmailResult(null);
    try {
      const res = await fetch(`/api/tournaments/events/${eventId}/email-scoring-links`, {
        method: 'POST',
      });
      const data = await res.json();
      setEmailResult(data);
    } catch {
      /* swallow */
    }
    setEmailing(false);
  };

  const importToEvent = async () => {
    if (
      !confirm(
        'Import all confirmed signups into the event-players list? This creates player records the existing event admin can use for matches.'
      )
    )
      return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch(`/api/events/${eventId}/import-signups`, { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setImportResult(data);
        await fetchAll();
        // Notify the page to refetch its players list. Simplest: full reload.
        if (data.players_created > 0) {
          setTimeout(() => window.location.reload(), 1200);
        }
      }
    } catch {
      /* swallow */
    }
    setImporting(false);
  };

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6 flex items-center gap-2">
        <Loader2 className="animate-spin text-orange-500" size={16} />
        <span className="text-sm text-gray-600">Loading public signups…</span>
      </div>
    );
  }

  // Don't render the panel if this event isn't open to public signup.
  if (!event || !event.public_registration) return null;

  const inDraw = entries.filter((x) => x.position === 'in_draw').length;
  const waitlist = entries.filter((x) => x.position === 'waitlist').length;
  const pending = entries.filter((x) => x.position === 'pending_payment').length;

  return (
    <div className="bg-white border-2 border-emerald-200 rounded-xl p-4 mb-6 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Users size={18} className="text-emerald-600" />
          <h2 className="font-semibold text-gray-900">Public Signups</h2>
          <span className="text-sm text-gray-600">
            · {inDraw} confirmed · {waitlist} waitlist · {pending} pending pmt
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={importToEvent}
            disabled={importing || entries.filter((e) => e.position === 'in_draw' && !e.imported_at).length === 0}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-xs font-semibold disabled:opacity-50"
          >
            {importing ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Import to event
          </button>
          <button
            onClick={emailScoringLinks}
            disabled={emailing || inDraw === 0}
            className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold disabled:opacity-50"
          >
            {emailing ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
            Email scoring links
          </button>
        </div>
      </div>

      {importResult && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-2 text-sm">
          ✓ Imported {importResult.signups_imported} signups, created{' '}
          {importResult.players_created} player records. Reloading…
        </div>
      )}

      {publicUrl && (
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-2 flex items-center gap-2 text-sm">
          <Share2 size={14} className="text-orange-600 flex-shrink-0" />
          <div className="text-orange-900 flex-1 truncate">
            <a href={publicUrl} target="_blank" className="font-mono underline">
              {publicUrl}
            </a>
          </div>
          <button
            onClick={copyLink}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-600 hover:bg-orange-700 text-white rounded text-xs font-semibold flex-shrink-0"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      )}

      {emailResult && (
        <p className="text-sm text-emerald-700 font-medium">
          ✓ Sent {emailResult.sent} of {emailResult.total} emails.
        </p>
      )}

      {entries.length === 0 ? (
        <div className="text-sm text-gray-500 text-center py-4">
          No signups yet. Share the link above to start collecting.
        </div>
      ) : (
        <div className="border border-gray-200 rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="text-left px-3 py-1.5">Player</th>
                <th className="text-left px-3 py-1.5">Status</th>
                <th className="text-left px-3 py-1.5">Pmt</th>
                <th className="text-right px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const pos = POSITION_LABELS[entry.position];
                return (
                  <tr key={entry.id} className="border-t border-gray-100">
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-gray-900">{entry.player_name}</div>
                      <div className="text-xs text-gray-500">
                        {entry.player_email || entry.parent_email || '—'}
                        {entry.partner_name && ` · w/ ${entry.partner_name}`}
                        {entry.notes && ` · ${entry.notes}`}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${pos.color}`}
                      >
                        {pos.label}
                      </span>
                      {entry.imported_at && (
                        <span className="ml-1 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
                          Imported
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-gray-700 text-xs">{entry.payment_status}</td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        {entry.position === 'waitlist' && (
                          <button
                            onClick={() => setPosition(entry.id, 'in_draw')}
                            disabled={busy === entry.id}
                            title="Promote to confirmed"
                            className="p-1 hover:bg-emerald-50 text-emerald-600 rounded"
                          >
                            <ArrowUp size={12} />
                          </button>
                        )}
                        {entry.position === 'in_draw' && (
                          <button
                            onClick={() => setPosition(entry.id, 'waitlist')}
                            disabled={busy === entry.id}
                            title="Move to waitlist"
                            className="p-1 hover:bg-amber-50 text-amber-600 rounded"
                          >
                            <ArrowDown size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => removeEntry(entry.id)}
                          title="Delete signup"
                          className="p-1 hover:bg-red-50 text-red-500 rounded"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500">
        💡 These signups are tracked separately from the legacy event-players list. Add players to
        the event manually below to set up matches. (Auto-import coming next.)
      </p>
    </div>
  );
}

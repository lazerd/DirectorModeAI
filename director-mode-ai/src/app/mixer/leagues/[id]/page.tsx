'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Calendar,
  Copy,
  QrCode,
  Users,
  Check,
  X,
  ExternalLink,
  AlertCircle,
  Download,
  Zap,
  Loader2,
  Bell,
  UserMinus,
  GitBranch,
  UserPlus,
  Trophy,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import { CATEGORY_LABELS, formatMoney, isDoubles, type CategoryKey } from '@/lib/leagueUtils';
import FlightBracketView, {
  type BracketMatch,
  type BracketFlight,
} from '@/components/leagues/FlightBracketView';

const NTRP_OPTIONS = ['2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0'];

type League = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: string;
  league_type: 'compass' | 'round_robin' | 'single_elimination';
  venmo_handle: string | null;
  zelle_handle: string | null;
  stripe_payment_link: string | null;
};

type Category = {
  id: string;
  category_key: CategoryKey;
  entry_fee_cents: number;
  is_enabled: boolean;
};

type NewEntryForm = {
  categoryKey: CategoryKey;
  captainName: string;
  captainEmail: string;
  captainPhone: string;
  captainNtrp: string;
  captainWtn: string;
  partnerName: string;
  partnerEmail: string;
  partnerPhone: string;
  partnerNtrp: string;
  partnerWtn: string;
  markPaid: boolean;
};

const emptyNewEntry = (key: CategoryKey): NewEntryForm => ({
  categoryKey: key,
  captainName: '',
  captainEmail: '',
  captainPhone: '',
  captainNtrp: '',
  captainWtn: '',
  partnerName: '',
  partnerEmail: '',
  partnerPhone: '',
  partnerNtrp: '',
  partnerWtn: '',
  markPaid: true,
});

type Entry = {
  id: string;
  category_id: string;
  captain_name: string;
  captain_email: string;
  captain_phone: string | null;
  captain_ntrp: number | null;
  captain_utr: number | null;
  captain_wtn: number | null;
  partner_name: string | null;
  partner_email: string | null;
  partner_confirmed_at: string | null;
  composite_score: number | null;
  manual_seed: number | null;
  rating_source: string | null;
  payment_status: string;
  entry_status: string;
  flight_id: string | null;
  seed_in_flight: number | null;
  created_at: string;
};

type Flight = {
  id: string;
  category_id: string;
  flight_name: string;
  size: number;
  num_rounds: number;
  status: string;
};

export default function LeagueDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [league, setLeague] = useState<League | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [allMatches, setAllMatches] = useState<BracketMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedBracketCategoryId, setExpandedBracketCategoryId] = useState<string | null>(null);
  const [scoreEntryMatch, setScoreEntryMatch] = useState<BracketMatch | null>(null);
  const [scoreInput, setScoreInput] = useState('');
  const [scoreWinnerId, setScoreWinnerId] = useState<string | null>(null);
  const [savingScore, setSavingScore] = useState(false);
  const [deletingScore, setDeletingScore] = useState(false);
  const [scoreModalError, setScoreModalError] = useState<string | null>(null);
  const [regeneratingCategoryId, setRegeneratingCategoryId] = useState<string | null>(null);
  const [seedingCategoryId, setSeedingCategoryId] = useState<string | null>(null);
  const [seedOverrides, setSeedOverrides] = useState<Record<string, string>>({});
  const [savingSeeds, setSavingSeeds] = useState(false);
  const [generatingCategoryId, setGeneratingCategoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const [addingToCategory, setAddingToCategory] = useState<string | null>(null);
  const [newEntry, setNewEntry] = useState<NewEntryForm>(emptyNewEntry('men_singles'));
  const [savingEntry, setSavingEntry] = useState(false);
  const [addEntryError, setAddEntryError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const supabase = createClient();
    const [l, c, e, f] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', id).single(),
      supabase.from('league_categories').select('*').eq('league_id', id).order('category_key'),
      supabase.from('league_entries').select('*').eq('league_id', id).order('created_at', { ascending: false }),
      supabase.from('league_flights').select('id, category_id, flight_name, size, num_rounds, status').eq('league_id', id),
    ]);
    if (l.error) setError(l.error.message);
    setLeague((l.data as League) || null);
    setCategories((c.data as Category[]) || []);
    setEntries((e.data as Entry[]) || []);
    const flightList = ((f.data as Flight[]) || []);
    setFlights(flightList);

    // Load all matches for the flights in this league
    if (flightList.length > 0) {
      const flightIds = flightList.map(fl => fl.id);
      const { data: matchData } = await supabase
        .from('league_matches')
        .select('id, flight_id, round, match_index, bracket_position, entry_a_id, entry_b_id, score, winner_entry_id, status, deadline')
        .in('flight_id', flightIds);
      setAllMatches(((matchData as any[]) || []) as BracketMatch[]);
    } else {
      setAllMatches([]);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (!league) return;
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/leagues/${league.slug}`;
    QRCode.toDataURL(url, { width: 512, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [league]);

  /**
   * Flip an entry's payment_status. Optimistically updates the UI, then
   * calls the director-only API endpoint; rolls back on failure. Allowed
   * targets: 'paid' | 'pending' | 'waived' | 'refunded'. The 'refund_pending'
   * state is set automatically by the withdraw flow and is not a valid
   * manual target — the endpoint rejects it.
   */
  const setPaymentStatus = async (
    entry: Entry,
    next: 'paid' | 'pending' | 'waived' | 'refunded'
  ) => {
    const previous = entry.payment_status;
    setEntries(prev =>
      prev.map(e => (e.id === entry.id ? { ...e, payment_status: next } : e))
    );
    try {
      const res = await fetch(`/api/leagues/entries/${entry.id}/payment-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Failed: ${data.error || `HTTP ${res.status}`}`);
        setEntries(prev =>
          prev.map(e => (e.id === entry.id ? { ...e, payment_status: previous } : e))
        );
      }
    } catch (err: any) {
      alert(`Network error: ${err?.message || 'unknown'}`);
      setEntries(prev =>
        prev.map(e => (e.id === entry.id ? { ...e, payment_status: previous } : e))
      );
    }
  };

  const withdrawEntry = async (entry: Entry) => {
    if (!confirm(`Withdraw ${entry.captain_name}? This flags them for a refund if they'd paid.`)) return;
    const res = await fetch(`/api/leagues/entries/${entry.id}/withdraw`, { method: 'POST' });
    if (!res.ok) {
      const d = await res.json();
      alert(`Failed: ${d.error}`);
      return;
    }
    fetchAll();
  };

  const openAddEntry = (cat: Category) => {
    setNewEntry(emptyNewEntry(cat.category_key));
    setAddingToCategory(cat.id);
    setAddEntryError(null);
  };

  const closeAddEntry = () => {
    setAddingToCategory(null);
    setAddEntryError(null);
  };

  const submitAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!league) return;
    setAddEntryError(null);

    if (!newEntry.captainName || !newEntry.captainEmail || !newEntry.captainNtrp) {
      setAddEntryError('Name, email, and NTRP are required.');
      return;
    }
    const doubles = isDoubles(newEntry.categoryKey);
    if (doubles && (!newEntry.partnerName || !newEntry.partnerNtrp)) {
      setAddEntryError('Partner name and NTRP are required for doubles.');
      return;
    }

    setSavingEntry(true);
    try {
      const res = await fetch(`/api/leagues/${league.id}/add-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          categoryKey: newEntry.categoryKey,
          captainName: newEntry.captainName,
          captainEmail: newEntry.captainEmail,
          captainPhone: newEntry.captainPhone || null,
          captainNtrp: parseFloat(newEntry.captainNtrp),
          captainWtn: newEntry.captainWtn ? parseFloat(newEntry.captainWtn) : null,
          partnerName: doubles ? newEntry.partnerName : null,
          partnerEmail: doubles ? newEntry.partnerEmail || null : null,
          partnerPhone: doubles ? newEntry.partnerPhone || null : null,
          partnerNtrp: doubles ? parseFloat(newEntry.partnerNtrp) : null,
          partnerWtn: doubles && newEntry.partnerWtn ? parseFloat(newEntry.partnerWtn) : null,
          markPaid: newEntry.markPaid,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddEntryError(data.error || `HTTP ${res.status}`);
        return;
      }
      closeAddEntry();
      fetchAll();
    } catch (err: any) {
      setAddEntryError(err.message || 'Network error');
    } finally {
      setSavingEntry(false);
    }
  };

  // --- Admin score entry ---
  const openScoreEntry = (match: BracketMatch) => {
    setScoreEntryMatch(match);
    setScoreInput(match.score || '');
    setScoreWinnerId(match.winner_entry_id || null);
    setScoreModalError(null);
  };

  const closeScoreEntry = () => {
    setScoreEntryMatch(null);
    setScoreInput('');
    setScoreWinnerId(null);
    setScoreModalError(null);
  };

  const submitScore = async () => {
    if (!scoreEntryMatch || !scoreInput.trim() || !scoreWinnerId) return;
    setSavingScore(true);
    setScoreModalError(null);
    try {
      const res = await fetch(`/api/leagues/matches/${scoreEntryMatch.id}/admin-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score: scoreInput.trim(), winnerEntryId: scoreWinnerId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScoreModalError(data.error || `Failed to save score (HTTP ${res.status})`);
        return;
      }
      closeScoreEntry();
      fetchAll();
    } catch (err: any) {
      setScoreModalError(err?.message || 'Network error');
    } finally {
      setSavingScore(false);
    }
  };

  const deleteScore = async () => {
    if (!scoreEntryMatch) return;
    if (
      !confirm(
        'Clear this result? The match will go back to pending and the entries will stay in place. ' +
          'If the winner has already advanced to later rounds, you will need to clear those first.'
      )
    ) {
      return;
    }
    setDeletingScore(true);
    setScoreModalError(null);
    try {
      const res = await fetch(`/api/leagues/matches/${scoreEntryMatch.id}/admin-report`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) {
        setScoreModalError(data.error || `Failed to clear result (HTTP ${res.status})`);
        return;
      }
      closeScoreEntry();
      fetchAll();
    } catch (err: any) {
      setScoreModalError(err?.message || 'Network error');
    } finally {
      setDeletingScore(false);
    }
  };

  // --- Regenerate draws for a category ---
  const regenerateCategory = async (cat: Category) => {
    if (!league) return;
    if (!confirm(
      `Regenerate draws for ${CATEGORY_LABELS[cat.category_key]}?\n\n` +
      `This will DELETE all flights, matches, and emails for this category and create new ones. ` +
      `Any confirmed scores will block the delete — clear them first if needed.`
    )) return;

    setRegeneratingCategoryId(cat.id);
    try {
      // Step 1: delete existing
      const delRes = await fetch(`/api/leagues/${league.id}/delete-draws`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKey: cat.category_key }),
      });
      const delData = await delRes.json();
      if (!delRes.ok) {
        alert(`Delete failed: ${delData.error}`);
        setRegeneratingCategoryId(null);
        return;
      }
      // Step 2: regenerate
      const genRes = await fetch(`/api/leagues/${league.id}/generate-draws`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKey: cat.category_key }),
      });
      const genData = await genRes.json();
      if (!genRes.ok) {
        alert(`Regenerate failed: ${genData.error}`);
        setRegeneratingCategoryId(null);
        return;
      }
      await fetchAll();
    } finally {
      setRegeneratingCategoryId(null);
    }
  };

  const sendReminders = async () => {
    if (!league) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/leagues/${league.id}/send-reminders`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setGenerateResult(`Error: ${data.error}`);
      else setGenerateResult(`Sent ${data.sent} reminder emails across ${data.matches || 0} matches.`);
    } finally {
      setGenerating(false);
    }
  };

  const copyUrl = () => {
    if (!league) return;
    const url = `${window.location.origin}/leagues/${league.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadQr = () => {
    if (!qrDataUrl || !league) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `${league.slug}-qr.png`;
    a.click();
  };

  const generateDrawsForCategory = async (cat: Category) => {
    if (!league) return;
    const catEntries = entries.filter(
      e => e.category_id === cat.id && e.payment_status === 'paid' && e.entry_status === 'active'
    );
    if (catEntries.length < 2) {
      alert(`Not enough paid active entries in ${CATEGORY_LABELS[cat.category_key]} (${catEntries.length}).`);
      return;
    }
    if (!confirm(
      `Generate draws for ${CATEGORY_LABELS[cat.category_key]}?\n\n` +
      `${catEntries.length} paid entries will be seeded and Round 1 emails will go out immediately. ` +
      `Other categories are not affected.`
    )) return;

    setGeneratingCategoryId(cat.id);
    setGenerateResult(null);
    try {
      const res = await fetch(`/api/leagues/${league.id}/generate-draws`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryKey: cat.category_key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenerateResult(`Error: ${data.error || 'Unknown'}`);
        return;
      }
      const r = (data.results || [])[0];
      if (!r) {
        setGenerateResult('No results returned.');
      } else if (r.skipped) {
        setGenerateResult(`${r.category}: already generated.`);
      } else if (r.cancelled) {
        setGenerateResult(`${r.category}: cancelled (${r.waitlisted} refunds needed).`);
      } else {
        setGenerateResult(
          `${r.category}: ${r.flightsCreated} flight${r.flightsCreated === 1 ? '' : 's'}, ${r.matchesCreated} matches created. Sent ${data.emailCount || 0} player emails.`
        );
      }
      fetchAll();
    } catch (err: any) {
      setGenerateResult(`Error: ${err.message || 'Unknown'}`);
    } finally {
      setGeneratingCategoryId(null);
    }
  };

  // --- Seeding preview + edit ---
  const openSeeding = (cat: Category) => {
    setSeedingCategoryId(cat.id);
    // Seed the override map with current manual_seed values
    const initial: Record<string, string> = {};
    entries
      .filter(e => e.category_id === cat.id && e.payment_status === 'paid' && e.entry_status === 'active')
      .forEach(e => {
        if (e.manual_seed != null) initial[e.id] = String(e.manual_seed);
      });
    setSeedOverrides(initial);
  };

  const closeSeeding = () => {
    setSeedingCategoryId(null);
    setSeedOverrides({});
  };

  const saveSeeding = async () => {
    if (!seedingCategoryId) return;
    setSavingSeeds(true);
    const supabase = createClient();
    // For each entry with an override, update manual_seed. For entries whose
    // override is empty, clear manual_seed (null).
    const cat = categories.find(c => c.id === seedingCategoryId);
    const catEntries = entries.filter(
      e => e.category_id === seedingCategoryId && e.payment_status === 'paid' && e.entry_status !== 'withdrawn'
    );
    for (const e of catEntries) {
      const override = seedOverrides[e.id];
      const next = override && override.trim() !== '' ? parseInt(override, 10) : null;
      if (next !== e.manual_seed) {
        await supabase
          .from('league_entries')
          .update({ manual_seed: next })
          .eq('id', e.id);
      }
    }

    // If draws already exist for this category, auto-regenerate so the new
    // seeds actually move players around in the bracket. Otherwise the
    // seeds are just stored for the next Generate Draws click.
    const hasExistingFlights = cat && flights.some(f => f.category_id === cat.id);
    if (cat && hasExistingFlights && league) {
      try {
        const delRes = await fetch(`/api/leagues/${league.id}/delete-draws`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryKey: cat.category_key }),
        });
        const delData = await delRes.json();
        if (!delRes.ok) {
          alert(
            `Seeds saved, but couldn't regenerate draws: ${delData.error}.\n\n` +
            `If you have confirmed match results, clear them first or use "Regenerate" after manually cleaning up.`
          );
          setSavingSeeds(false);
          closeSeeding();
          fetchAll();
          return;
        }
        const genRes = await fetch(`/api/leagues/${league.id}/generate-draws`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ categoryKey: cat.category_key }),
        });
        const genData = await genRes.json();
        if (!genRes.ok) {
          alert(`Seeds saved and old draws deleted, but regenerate failed: ${genData.error}`);
        }
      } catch (err: any) {
        alert(`Seeds saved, but regenerate failed: ${err.message}`);
      }
    }

    setSavingSeeds(false);
    closeSeeding();
    fetchAll();
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[300px]">
        <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!league) {
    return (
      <div className="p-6">
        <Link href="/mixer/leagues" className="text-sm text-gray-500 hover:text-gray-900">← Back to leagues</Link>
        <div className="mt-4 bg-red-50 text-red-700 border border-red-200 rounded-lg p-4">
          {error || 'League not found.'}
        </div>
      </div>
    );
  }

  const publicUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/leagues/${league.slug}`;

  // Group entries by category
  const entriesByCategory: Record<string, Entry[]> = {};
  for (const e of entries) {
    (entriesByCategory[e.category_id] ||= []).push(e);
  }

  const paidCount = entries.filter(e => e.payment_status === 'paid').length;
  const pendingCount = entries.filter(e => e.payment_status === 'pending').length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/mixer/leagues" className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-2xl text-gray-900 truncate">{league.name}</h1>
          <div className="flex items-center gap-3 text-sm text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Calendar size={14} />
              {format(new Date(league.start_date), 'MM/dd/yyyy')} – {format(new Date(league.end_date), 'MM/dd/yyyy')}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">{league.status}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Left column: share block + summary */}
        <div className="lg:col-span-1 space-y-4">
          {/* Public URL + QR */}
          <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
            <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-gray-900">
              <QrCode size={16} className="text-orange-500" />
              Public signup page
            </h2>
            <div className="flex gap-2 mb-3">
              <input
                readOnly
                value={publicUrl}
                onClick={e => (e.target as HTMLInputElement).select()}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono text-gray-900 bg-gray-50"
              />
              <button
                onClick={copyUrl}
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                title="Copy URL"
              >
                {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
              </button>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                title="Open in new tab"
              >
                <ExternalLink size={16} />
              </a>
            </div>
            {qrDataUrl && (
              <div className="flex flex-col items-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="Signup QR" className="w-40 h-40 border border-gray-200 rounded-lg mb-2" />
                <button
                  onClick={downloadQr}
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                >
                  <Download size={12} />
                  Download PNG
                </button>
              </div>
            )}
            {(league.status === 'running' || league.status === 'completed') && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <a
                  href={`${publicUrl}/bracket`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                >
                  <GitBranch size={12} />
                  Public brackets page
                </a>
              </div>
            )}
          </section>

          {/* Stats */}
          <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
            <h2 className="font-semibold text-base mb-3 flex items-center gap-2 text-gray-900">
              <Users size={16} className="text-orange-500" />
              Entries
            </h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Total</span>
                <span className="font-medium text-gray-900">{entries.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Paid</span>
                <span className="font-medium text-green-600">{paidCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Pending</span>
                <span className="font-medium text-yellow-600">{pendingCount}</span>
              </div>
            </div>
          </section>

          {/* Payment rails */}
          <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
            <h2 className="font-semibold text-base mb-3 text-gray-900">Payment rails</h2>
            <div className="space-y-2 text-sm">
              <PaymentRailRow label="Venmo" value={league.venmo_handle} />
              <PaymentRailRow label="Zelle" value={league.zelle_handle} />
              <PaymentRailRow label="Stripe" value={league.stripe_payment_link ? 'Link configured' : null} />
            </div>
          </section>

          {/* Per-category generate now lives in each category section */}
          {generateResult && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-xs">
              {generateResult}
            </div>
          )}
          {league.status === 'running' && (
            <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
              <h2 className="font-semibold text-base mb-2 text-gray-900">Send reminders</h2>
              <p className="text-xs text-gray-500 mb-3">
                Email every player whose current match is within 3 days of the deadline and hasn&apos;t been reported yet.
              </p>
              <button
                onClick={sendReminders}
                disabled={generating}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg font-medium hover:bg-yellow-700 disabled:opacity-50"
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Bell size={16} />}
                Send reminders
              </button>
            </section>
          )}

          {(league.status === 'running' || league.status === 'completed') && (
            <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
              <h2 className="font-semibold text-base mb-2 text-gray-900">Lock in overdue reports</h2>
              <p className="text-xs text-gray-500 mb-3">
                Winners advance automatically as soon as you enter a score. This button is only
                for <strong>player-reported</strong> scores that are past the 24-hour dispute window
                but haven&apos;t been locked in yet. Runs any time you click.
              </p>
              <button
                onClick={async () => {
                  setGenerating(true);
                  setGenerateResult(null);
                  try {
                    const res = await fetch(`/api/leagues/progress?leagueId=${league.id}`, { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) {
                      setGenerateResult(`Error: ${data.error}`);
                    } else {
                      const s = data.summary;
                      setGenerateResult(
                        `Locked in ${s.autoConfirmed} overdue score${s.autoConfirmed === 1 ? '' : 's'}, ` +
                        `filled ${s.newSlotsFilled} bracket slot${s.newSlotsFilled === 1 ? '' : 's'}, ` +
                        `completed ${s.flightsCompleted} flight${s.flightsCompleted === 1 ? '' : 's'}. ` +
                        `${s.emailsSent} email${s.emailsSent === 1 ? '' : 's'} sent.`
                      );
                      fetchAll();
                    }
                  } finally {
                    setGenerating(false);
                  }
                }}
                disabled={generating}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                {generating ? 'Locking in…' : 'Lock in overdue reports'}
              </button>
              {generateResult && <p className="text-xs text-gray-600 mt-2">{generateResult}</p>}
            </section>
          )}
        </div>

        {/* Right column: entries grouped by category */}
        <div className="lg:col-span-2 space-y-4">
          {categories.map(cat => {
            const catEntries = entriesByCategory[cat.id] || [];
            const doubles = isDoubles(cat.category_key);
            const isAdding = addingToCategory === cat.id;
            const hasFlights = flights.some(f => f.category_id === cat.id);

            // Payment status breakdown per category. We only count active
            // entries toward paid/pending/waived (withdrawn entries already
            // have their own tracking via refund_pending / refunded).
            const activeEntries = catEntries.filter(e => e.entry_status !== 'withdrawn');
            const paidEntries = activeEntries.filter(e => e.payment_status === 'paid');
            const pendingEntries = activeEntries.filter(e => e.payment_status === 'pending');
            const waivedEntries = activeEntries.filter(e => e.payment_status === 'waived');
            const refundPendingEntries = catEntries.filter(e => e.payment_status === 'refund_pending');
            const paidCount = paidEntries.length;
            const fee = cat.entry_fee_cents;
            const collected = paidCount * fee;
            const outstanding = pendingEntries.length * fee;

            const isGenerating = generatingCategoryId === cat.id;
            const isSeeding = seedingCategoryId === cat.id;
            return (
              <section key={cat.id} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div>
                    <h2 className="font-semibold text-base text-gray-900">{CATEGORY_LABELS[cat.category_key]}</h2>
                    <div className="text-xs text-gray-500 flex items-center gap-2">
                      <span>
                        {formatMoney(fee)}
                        <span className="text-gray-400 ml-1">/ {doubles ? 'team' : 'player'}</span>
                      </span>
                      <span>·</span>
                      <span>{activeEntries.length} active {activeEntries.length === 1 ? 'entry' : 'entries'}</span>
                      {hasFlights && <span className="text-green-600">· draws generated</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => (isAdding ? closeAddEntry() : openAddEntry(cat))}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 rounded"
                    >
                      {isAdding ? <X size={12} /> : <UserPlus size={12} />}
                      {isAdding ? 'Cancel' : 'Add entry'}
                    </button>
                    {paidCount >= 2 && (
                      <button
                        onClick={() => (isSeeding ? closeSeeding() : openSeeding(cat))}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded"
                      >
                        <GitBranch size={12} />
                        {isSeeding ? 'Cancel seeding' : 'Edit seeding'}
                      </button>
                    )}
                    {!hasFlights && paidCount >= 2 && (
                      <button
                        onClick={() => generateDrawsForCategory(cat)}
                        disabled={isGenerating}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-orange-500 text-white hover:bg-orange-600 rounded disabled:opacity-50"
                      >
                        {isGenerating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                        {isGenerating ? 'Generating…' : 'Generate draws'}
                      </button>
                    )}
                    {hasFlights && (
                      <>
                        <button
                          onClick={() =>
                            setExpandedBracketCategoryId(
                              expandedBracketCategoryId === cat.id ? null : cat.id
                            )
                          }
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 rounded"
                        >
                          <Trophy size={12} />
                          {expandedBracketCategoryId === cat.id ? 'Hide bracket' : 'View bracket'}
                        </button>
                        <button
                          onClick={() => regenerateCategory(cat)}
                          disabled={regeneratingCategoryId === cat.id}
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                          title="Delete and regenerate draws for this category"
                        >
                          {regeneratingCategoryId === cat.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Zap size={12} />
                          )}
                          Regenerate
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Payment status summary pills — at-a-glance view of how
                    much has been collected vs how much is still outstanding
                    per category. Derived from league_categories.entry_fee_cents
                    and league_entries.payment_status, no new tables. */}
                {activeEntries.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-green-100 text-green-800 border border-green-200">
                      <Check size={11} />
                      {paidCount} paid · {formatMoney(collected)}
                    </span>
                    {pendingEntries.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-yellow-100 text-yellow-800 border border-yellow-200">
                        {pendingEntries.length} pending · {formatMoney(outstanding)}
                      </span>
                    )}
                    {waivedEntries.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-100 text-blue-800 border border-blue-200">
                        {waivedEntries.length} waived
                      </span>
                    )}
                    {refundPendingEntries.length > 0 && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-100 text-red-800 border border-red-200">
                        <AlertCircle size={11} />
                        {refundPendingEntries.length} refund {refundPendingEntries.length === 1 ? 'owed' : 'owed'}
                      </span>
                    )}
                  </div>
                )}

                {isSeeding && (
                  <SeedingEditor
                    entries={catEntries.filter(e => e.payment_status === 'paid' && e.entry_status !== 'withdrawn')}
                    overrides={seedOverrides}
                    onChange={(entryId, v) => setSeedOverrides(prev => ({ ...prev, [entryId]: v }))}
                    onSave={saveSeeding}
                    onCancel={closeSeeding}
                    saving={savingSeeds}
                    willRegenerate={hasFlights}
                  />
                )}

                {isAdding && (
                  <form onSubmit={submitAddEntry} className="bg-orange-50 border border-orange-200 rounded-lg p-3 sm:p-4 mb-3 space-y-3">
                    <div className="text-xs uppercase tracking-wide text-orange-700 font-semibold">
                      {doubles ? 'Captain' : 'Player'}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        required
                        placeholder="Full name *"
                        value={newEntry.captainName}
                        onChange={e => setNewEntry(prev => ({ ...prev, captainName: e.target.value }))}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 sm:col-span-2"
                      />
                      <input
                        required
                        type="email"
                        placeholder="Email *"
                        value={newEntry.captainEmail}
                        onChange={e => setNewEntry(prev => ({ ...prev, captainEmail: e.target.value }))}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                      />
                      <input
                        type="tel"
                        placeholder="Phone"
                        value={newEntry.captainPhone}
                        onChange={e => setNewEntry(prev => ({ ...prev, captainPhone: e.target.value }))}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                      />
                      <select
                        required
                        value={newEntry.captainNtrp}
                        onChange={e => setNewEntry(prev => ({ ...prev, captainNtrp: e.target.value }))}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                      >
                        <option value="">NTRP *</option>
                        {NTRP_OPTIONS.map(n => <option key={n} value={n}>NTRP {n}</option>)}
                      </select>
                      <input
                        type="number"
                        step="0.1"
                        min={1}
                        max={40}
                        placeholder="WTN (optional)"
                        value={newEntry.captainWtn}
                        onChange={e => setNewEntry(prev => ({ ...prev, captainWtn: e.target.value }))}
                        className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                      />
                    </div>

                    {doubles && (
                      <>
                        <div className="text-xs uppercase tracking-wide text-orange-700 font-semibold pt-2 border-t border-orange-200">Partner</div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            required
                            placeholder="Partner name *"
                            value={newEntry.partnerName}
                            onChange={e => setNewEntry(prev => ({ ...prev, partnerName: e.target.value }))}
                            className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900 sm:col-span-2"
                          />
                          <input
                            type="email"
                            placeholder="Partner email"
                            value={newEntry.partnerEmail}
                            onChange={e => setNewEntry(prev => ({ ...prev, partnerEmail: e.target.value }))}
                            className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                          />
                          <input
                            type="tel"
                            placeholder="Partner phone"
                            value={newEntry.partnerPhone}
                            onChange={e => setNewEntry(prev => ({ ...prev, partnerPhone: e.target.value }))}
                            className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                          />
                          <select
                            required
                            value={newEntry.partnerNtrp}
                            onChange={e => setNewEntry(prev => ({ ...prev, partnerNtrp: e.target.value }))}
                            className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                          >
                            <option value="">Partner NTRP *</option>
                            {NTRP_OPTIONS.map(n => <option key={n} value={n}>NTRP {n}</option>)}
                          </select>
                          <input
                            type="number"
                            step="0.1"
                            min={1}
                            max={40}
                            placeholder="Partner WTN"
                            value={newEntry.partnerWtn}
                            onChange={e => setNewEntry(prev => ({ ...prev, partnerWtn: e.target.value }))}
                            className="px-2 py-1.5 border border-gray-300 rounded text-sm text-gray-900"
                          />
                        </div>
                      </>
                    )}

                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={newEntry.markPaid}
                        onChange={e => setNewEntry(prev => ({ ...prev, markPaid: e.target.checked }))}
                        className="w-3.5 h-3.5"
                      />
                      Mark as paid
                    </label>

                    {addEntryError && (
                      <div className="text-xs text-red-600 flex items-start gap-1">
                        <AlertCircle size={12} className="mt-0.5" />
                        {addEntryError}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={closeAddEntry}
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={savingEntry}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-3 py-1.5 text-sm bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                      >
                        {savingEntry && <Loader2 size={12} className="animate-spin" />}
                        {savingEntry ? 'Adding…' : 'Add entry'}
                      </button>
                    </div>
                  </form>
                )}

                {catEntries.length === 0 && !isAdding ? (
                  <p className="text-sm text-gray-400 italic">No entries yet.</p>
                ) : catEntries.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {catEntries.map(entry => (
                      <EntryRow
                        key={entry.id}
                        entry={entry}
                        onSetPayment={(status) => setPaymentStatus(entry, status)}
                        onWithdraw={() => withdrawEntry(entry)}
                      />
                    ))}
                  </div>
                ) : null}

                {/* Inline bracket view for this category */}
                {hasFlights && expandedBracketCategoryId === cat.id && (
                  <div className="mt-5 pt-5 border-t border-gray-200 space-y-8">
                    {flights
                      .filter(f => f.category_id === cat.id)
                      .sort((a, b) => a.flight_name.localeCompare(b.flight_name))
                      .map(flight => {
                        const flightEntries = catEntries
                          .filter(e => e.flight_id === flight.id)
                          .map(e => ({
                            id: e.id,
                            captain_name: e.captain_name,
                            partner_name: e.partner_name,
                            seed_in_flight: e.seed_in_flight,
                          }));
                        const flightMatches = allMatches.filter(m => m.flight_id === flight.id);
                        return (
                          <FlightBracketView
                            key={flight.id}
                            flight={flight as unknown as BracketFlight}
                            entries={flightEntries}
                            matches={flightMatches}
                            leagueType={league.league_type || 'compass'}
                            isAdmin
                            onMatchClick={openScoreEntry}
                            highlightedMatchId={scoreEntryMatch?.id || null}
                          />
                        );
                      })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Admin score entry modal */}
      {scoreEntryMatch && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={closeScoreEntry}
        >
          <div
            className="bg-white rounded-xl p-5 max-w-md w-full"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="font-semibold text-lg mb-1 text-gray-900">
              {scoreEntryMatch.winner_entry_id ? 'Edit result' : 'Enter score'}
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Admin-entered scores skip the 24-hour dispute window and lock in immediately.
              Winners advance automatically as soon as you save.
            </p>
            {(() => {
              const a = entries.find(e => e.id === scoreEntryMatch.entry_a_id);
              const b = entries.find(e => e.id === scoreEntryMatch.entry_b_id);
              const aLabel = a ? `${a.captain_name}${a.partner_name ? ' & ' + a.partner_name : ''}` : 'Team A';
              const bLabel = b ? `${b.captain_name}${b.partner_name ? ' & ' + b.partner_name : ''}` : 'Team B';
              const hasExistingResult = !!scoreEntryMatch.winner_entry_id;
              return (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Score</label>
                    <input
                      type="text"
                      value={scoreInput}
                      onChange={e => setScoreInput(e.target.value)}
                      placeholder="6-3, 4-6, 7-5"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-2">Winner</label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="adminWinner"
                          checked={scoreWinnerId === scoreEntryMatch.entry_a_id}
                          onChange={() => setScoreWinnerId(scoreEntryMatch.entry_a_id)}
                          disabled={!a}
                        />
                        <span className="text-sm text-gray-900 truncate">{aLabel}</span>
                      </label>
                      <label className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="adminWinner"
                          checked={scoreWinnerId === scoreEntryMatch.entry_b_id}
                          onChange={() => setScoreWinnerId(scoreEntryMatch.entry_b_id)}
                          disabled={!b}
                        />
                        <span className="text-sm text-gray-900 truncate">{bLabel}</span>
                      </label>
                    </div>
                  </div>
                  {scoreModalError && (
                    <div className="flex gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                      <div>{scoreModalError}</div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={closeScoreEntry}
                      className="flex-1 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                      disabled={savingScore || deletingScore}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitScore}
                      disabled={!scoreInput.trim() || !scoreWinnerId || savingScore || deletingScore}
                      className="flex-1 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 text-sm font-medium"
                    >
                      {savingScore ? 'Saving…' : hasExistingResult ? 'Save changes' : 'Save score'}
                    </button>
                  </div>
                  {hasExistingResult && (
                    <button
                      type="button"
                      onClick={deleteScore}
                      disabled={savingScore || deletingScore}
                      className="w-full py-2 border border-red-200 text-red-700 rounded-lg hover:bg-red-50 text-sm font-medium disabled:opacity-50"
                    >
                      {deletingScore ? 'Clearing…' : 'Delete result'}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function SeedingEditor({
  entries,
  overrides,
  onChange,
  onSave,
  onCancel,
  saving,
  willRegenerate,
}: {
  entries: Entry[];
  overrides: Record<string, string>;
  onChange: (entryId: string, value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  willRegenerate?: boolean;
}) {
  // Preview ordering: manual_seed (from overrides or existing) first, then composite desc
  const effectiveSeed = (e: Entry): number => {
    const override = overrides[e.id];
    if (override && override.trim() !== '') {
      const n = parseInt(override, 10);
      if (!isNaN(n)) return n;
    }
    if (e.manual_seed != null) return e.manual_seed;
    return 9999 - (e.composite_score ?? 0) * 100;
  };

  const sorted = [...entries].sort((a, b) => effectiveSeed(a) - effectiveSeed(b));

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-3">
      <div className="text-xs text-blue-900 mb-3">
        <strong>Auto-seed preview.</strong> Entries are ranked by composite score (UTR+NTRP+WTN blend).
        Type a number to override any seed — leave blank to use the auto order. The highest-ranked pair
        (1 and 2) are kept apart in round 1 by the bracket algorithm, so you don&apos;t need to manually
        avoid that.
      </div>
      {willRegenerate && (
        <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
          <strong>⚠️ Heads up:</strong> draws already exist for this category. Saving will <strong>delete and regenerate</strong> the bracket using your new seeds. Any confirmed match results will block the regenerate — clear them first.
        </div>
      )}
      <div className="space-y-1.5">
        {sorted.map((e, idx) => (
          <div key={e.id} className="flex items-center gap-2 text-sm">
            <span className="w-6 text-right text-blue-900 font-mono font-semibold">{idx + 1}.</span>
            <input
              type="number"
              min={1}
              placeholder="auto"
              value={overrides[e.id] ?? ''}
              onChange={ev => onChange(e.id, ev.target.value)}
              className="w-16 px-2 py-0.5 border border-blue-300 rounded text-xs text-gray-900"
              title="Manual seed override"
            />
            <span className="flex-1 text-gray-900 truncate">
              {e.captain_name}
              {e.partner_name && <> &amp; {e.partner_name}</>}
            </span>
            <span className="text-xs text-gray-500">
              {e.composite_score != null ? `score ${e.composite_score}` : 'unseeded'}
              {e.captain_ntrp != null && ` · ${e.captain_ntrp}`}
              {e.captain_utr != null && ` · UTR ${e.captain_utr}`}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-3 pt-3 border-t border-blue-200">
        <button
          onClick={onCancel}
          className="flex-1 px-3 py-1.5 text-sm border border-gray-300 bg-white rounded hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving
            ? (willRegenerate ? 'Regenerating…' : 'Saving…')
            : (willRegenerate ? 'Save & regenerate draws' : 'Save seed overrides')}
        </button>
      </div>
    </div>
  );
}

function PaymentRailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      {value ? (
        <span className="font-mono text-gray-900 text-xs truncate max-w-[180px]">{value}</span>
      ) : (
        <span className="text-gray-300 text-xs">not set</span>
      )}
    </div>
  );
}

type PaymentStatusOption = 'paid' | 'pending' | 'waived' | 'refunded';

function EntryRow({
  entry,
  onSetPayment,
  onWithdraw,
}: {
  entry: Entry;
  onSetPayment: (status: PaymentStatusOption) => void;
  onWithdraw: () => void;
}) {
  const isPendingPartner = entry.entry_status === 'pending_confirm';
  const isWithdrawn = entry.entry_status === 'withdrawn';
  const isWaitlisted = entry.entry_status === 'waitlisted';
  const status = entry.payment_status;
  const refundPending = status === 'refund_pending';

  // Color ramp per payment state so the pill reads at a glance.
  const pillClass =
    status === 'paid'
      ? 'bg-green-100 text-green-800 border-green-300'
      : status === 'waived'
        ? 'bg-blue-100 text-blue-800 border-blue-300'
        : status === 'refunded'
          ? 'bg-gray-100 text-gray-700 border-gray-300'
          : status === 'refund_pending'
            ? 'bg-red-100 text-red-800 border-red-300'
            : 'bg-yellow-100 text-yellow-800 border-yellow-300'; // pending (default)

  return (
    <div className={`py-3 flex items-center gap-3 text-sm ${isWithdrawn ? 'opacity-40' : ''}`}>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 truncate">
          {entry.captain_name}
          {entry.partner_name && (
            <> &amp; <span>{entry.partner_name}</span></>
          )}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-3 flex-wrap">
          <span className="truncate">{entry.captain_email}</span>
          {entry.captain_ntrp != null && <span>NTRP {entry.captain_ntrp}</span>}
          {entry.captain_utr != null && <span>UTR {entry.captain_utr}</span>}
          {entry.composite_score != null && (
            <span className="text-orange-600">score {entry.composite_score}</span>
          )}
          {isPendingPartner && (
            <span className="text-yellow-600 inline-flex items-center gap-0.5">
              <AlertCircle size={10} /> awaiting partner
            </span>
          )}
          {isWaitlisted && <span className="text-gray-400">waitlisted</span>}
          {isWithdrawn && <span className="text-gray-400">withdrawn</span>}
        </div>
      </div>
      {/* Native select styled as a pill — mobile gets the OS picker for free,
          desktop gets a dropdown. Optimistic update happens in onSetPayment. */}
      <select
        value={status}
        onChange={(e) => onSetPayment(e.target.value as PaymentStatusOption)}
        className={`appearance-none cursor-pointer px-2.5 py-1 pr-6 rounded-full text-xs font-semibold border ${pillClass}`}
        style={{
          backgroundImage:
            'url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%2710%27 viewBox=%270 0 20 20%27 fill=%27currentColor%27%3E%3Cpath d=%27M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.4a.75.75 0 01-1.08 0l-4.25-4.4a.75.75 0 01.02-1.06z%27/%3E%3C/svg%3E")',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 6px center',
        }}
        title="Change payment status"
      >
        {/* If the current state is refund_pending (set by withdraw, not
            manually), include it as the shown option so React's controlled
            value matches. Director closes it out by picking Refunded. */}
        {refundPending && <option value="refund_pending">⚠ Refund pending</option>}
        <option value="paid">✓ Paid</option>
        <option value="pending">○ Pending</option>
        <option value="waived">◉ Waived</option>
        <option value="refunded">↩ Refunded</option>
      </select>
      {!isWithdrawn && (
        <button
          onClick={onWithdraw}
          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded"
          title="Withdraw entry"
        >
          <UserMinus size={14} />
        </button>
      )}
    </div>
  );
}

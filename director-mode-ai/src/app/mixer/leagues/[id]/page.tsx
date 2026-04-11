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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import { CATEGORY_LABELS, formatMoney, isDoubles, type CategoryKey } from '@/lib/leagueUtils';

const NTRP_OPTIONS = ['2.5', '3.0', '3.5', '4.0', '4.5', '5.0', '5.5', '6.0'];

type League = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  start_date: string;
  end_date: string;
  status: string;
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
  rating_source: string | null;
  payment_status: string;
  entry_status: string;
  created_at: string;
};

export default function LeagueDetailPage() {
  const params = useParams();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [league, setLeague] = useState<League | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
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
    const [l, c, e] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', id).single(),
      supabase.from('league_categories').select('*').eq('league_id', id).order('category_key'),
      supabase.from('league_entries').select('*').eq('league_id', id).order('created_at', { ascending: false }),
    ]);
    if (l.error) setError(l.error.message);
    setLeague((l.data as League) || null);
    setCategories((c.data as Category[]) || []);
    setEntries((e.data as Entry[]) || []);
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

  const togglePayment = async (entry: Entry) => {
    const next = entry.payment_status === 'paid' ? 'pending' : 'paid';
    const supabase = createClient();
    const { error: err } = await supabase
      .from('league_entries')
      .update({ payment_status: next })
      .eq('id', entry.id);
    if (err) {
      alert(`Failed: ${err.message}`);
      return;
    }
    setEntries(prev => prev.map(e => (e.id === entry.id ? { ...e, payment_status: next } : e)));
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

  const generateDraws = async () => {
    if (!league) return;
    const paidCount = entries.filter(e => e.payment_status === 'paid' && e.entry_status === 'active').length;
    if (paidCount === 0) {
      alert('No paid active entries to place in draws.');
      return;
    }
    if (!confirm(
      `Generate draws for ${paidCount} paid entries now? This will create flights, seed players, send Round 1 emails, and flip the league to running status.`
    )) return;

    setGenerating(true);
    setGenerateResult(null);
    try {
      const res = await fetch(`/api/leagues/${league.id}/generate-draws`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setGenerateResult(`Error: ${data.error || 'Unknown'}`);
        return;
      }
      const summary = (data.results || [])
        .map((r: any) =>
          r.skipped
            ? `${r.category}: already generated`
            : r.cancelled
              ? `${r.category}: cancelled (${r.waitlisted} refunds needed)`
              : `${r.category}: ${r.flightsCreated} flights, ${r.matchesCreated} R1 matches${r.waitlisted > 0 ? `, ${r.waitlisted} waitlisted` : ''}`
        )
        .join(' · ');
      setGenerateResult(`Done. ${summary}. Sent ${data.emailCount || 0} player emails.`);
      fetchAll();
    } catch (err: any) {
      setGenerateResult(`Error: ${err.message || 'Unknown'}`);
    } finally {
      setGenerating(false);
    }
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

          {/* Generate draws action */}
          {league.status === 'open' && (
            <section className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
              <h2 className="font-semibold text-base mb-2 text-gray-900">Generate draws</h2>
              <p className="text-xs text-gray-500 mb-3">
                Ready to close registration? This slices all paid entries into compass draws (16s first,
                8s second, waitlist below 8), creates Round 1 matches, and emails every player.
              </p>
              <button
                onClick={generateDraws}
                disabled={generating}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg font-medium hover:bg-orange-600 disabled:opacity-50"
              >
                {generating ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                {generating ? 'Generating…' : 'Generate draws'}
              </button>
              {generateResult && (
                <p className="text-xs text-gray-600 mt-2">{generateResult}</p>
              )}
            </section>
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
              <h2 className="font-semibold text-base mb-2 text-gray-900">Bracket progression</h2>
              <p className="text-xs text-gray-500 mb-3">
                Auto-confirms reported scores past the 24h window and advances flights whose current round
                is complete. Runs any time you click.
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
                        `Auto-confirmed ${s.autoConfirmed}, generated ${s.nextRoundsGenerated} new rounds ` +
                        `(${s.newMatches} matches), completed ${s.flightsCompleted} flights. ${s.emailsSent} emails sent.`
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
                {generating ? 'Advancing…' : 'Advance brackets'}
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
            return (
              <section key={cat.id} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-base text-gray-900">{CATEGORY_LABELS[cat.category_key]}</h2>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span>
                      {formatMoney(cat.entry_fee_cents)}
                      <span className="text-gray-400 text-xs ml-1">/ {doubles ? 'team' : 'player'}</span>
                    </span>
                    <span>·</span>
                    <span>{catEntries.length} {catEntries.length === 1 ? 'entry' : 'entries'}</span>
                    <button
                      onClick={() => (isAdding ? closeAddEntry() : openAddEntry(cat))}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 rounded"
                    >
                      {isAdding ? <X size={12} /> : <UserPlus size={12} />}
                      {isAdding ? 'Cancel' : 'Add entry'}
                    </button>
                  </div>
                </div>

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
                        onTogglePay={() => togglePayment(entry)}
                        onWithdraw={() => withdrawEntry(entry)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
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

function EntryRow({
  entry,
  onTogglePay,
  onWithdraw,
}: {
  entry: Entry;
  onTogglePay: () => void;
  onWithdraw: () => void;
}) {
  const isPaid = entry.payment_status === 'paid';
  const isPendingPartner = entry.entry_status === 'pending_confirm';
  const isWithdrawn = entry.entry_status === 'withdrawn';
  const isWaitlisted = entry.entry_status === 'waitlisted';
  const refundPending = entry.payment_status === 'refund_pending';

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
          {refundPending && <span className="text-red-600">refund pending</span>}
        </div>
      </div>
      <button
        onClick={onTogglePay}
        className={`px-2 py-1 rounded-full text-xs font-medium ${
          refundPending
            ? 'bg-red-100 text-red-700'
            : isPaid
              ? 'bg-green-100 text-green-700'
              : 'bg-yellow-100 text-yellow-700'
        }`}
        title="Toggle payment status"
      >
        {refundPending ? (
          <span>refund</span>
        ) : isPaid ? (
          <span className="inline-flex items-center gap-1"><Check size={12} /> paid</span>
        ) : (
          <span className="inline-flex items-center gap-1"><X size={12} /> pending</span>
        )}
      </button>
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

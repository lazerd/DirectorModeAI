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
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';
import QRCode from 'qrcode';
import { CATEGORY_LABELS, formatMoney, type CategoryKey } from '@/lib/leagueUtils';

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
        </div>

        {/* Right column: entries grouped by category */}
        <div className="lg:col-span-2 space-y-4">
          {categories.map(cat => {
            const catEntries = entriesByCategory[cat.id] || [];
            return (
              <section key={cat.id} className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-semibold text-base text-gray-900">{CATEGORY_LABELS[cat.category_key]}</h2>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span>{formatMoney(cat.entry_fee_cents)}</span>
                    <span>·</span>
                    <span>{catEntries.length} {catEntries.length === 1 ? 'entry' : 'entries'}</span>
                  </div>
                </div>
                {catEntries.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No entries yet.</p>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {catEntries.map(entry => (
                      <EntryRow key={entry.id} entry={entry} onTogglePay={() => togglePayment(entry)} />
                    ))}
                  </div>
                )}
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

function EntryRow({ entry, onTogglePay }: { entry: Entry; onTogglePay: () => void }) {
  const isPaid = entry.payment_status === 'paid';
  const isPendingPartner = entry.entry_status === 'pending_confirm';
  return (
    <div className="py-3 flex items-center gap-3 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-gray-900 truncate">
          {entry.captain_name}
          {entry.partner_name && (
            <> &amp; <span>{entry.partner_name}</span></>
          )}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-3">
          <span className="truncate">{entry.captain_email}</span>
          {entry.captain_ntrp != null && <span>NTRP {entry.captain_ntrp}</span>}
          {entry.captain_utr != null && <span>UTR {entry.captain_utr}</span>}
          {isPendingPartner && (
            <span className="text-yellow-600 inline-flex items-center gap-0.5">
              <AlertCircle size={10} /> awaiting partner
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onTogglePay}
        className={`px-2 py-1 rounded-full text-xs font-medium ${
          isPaid ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
        }`}
        title="Toggle payment status"
      >
        {isPaid ? (
          <span className="inline-flex items-center gap-1"><Check size={12} /> paid</span>
        ) : (
          <span className="inline-flex items-center gap-1"><X size={12} /> pending</span>
        )}
      </button>
    </div>
  );
}

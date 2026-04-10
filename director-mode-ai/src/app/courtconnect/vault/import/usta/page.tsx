'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Search, Users, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type ScrapedPlayer = {
  usta_player_id: string;
  name: string;
  raw_name: string;
  city: string | null;
  gender: 'male' | 'female' | null;
  ntrp: string | null;
  ntrp_numeric: number | null;
};

type ScrapedRow = ScrapedPlayer & {
  selected: boolean;
  utr_singles: number | null;
  utr_doubles: number | null;
  utr_status: 'idle' | 'loading' | 'found' | 'not_found' | 'error';
};

type ScrapeResponse = {
  team_name: string | null;
  players: ScrapedPlayer[];
  source_url: string;
};

export default function UstaImportPage() {
  const [url, setUrl] = useState('');
  const [teamName, setTeamName] = useState<string | null>(null);
  const [rows, setRows] = useState<ScrapedRow[]>([]);
  const [scraping, setScraping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ inserted: number; skipped: number } | null>(null);

  const handleScrape = async () => {
    setError(null);
    setImportResult(null);
    setRows([]);
    setTeamName(null);

    if (!url.trim()) {
      setError('Please paste a USTA NorCal team URL.');
      return;
    }

    setScraping(true);
    try {
      const res = await fetch('/api/courtconnect/vault/usta-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data: ScrapeResponse | { error: string } = await res.json();
      if (!res.ok || 'error' in data) {
        throw new Error(('error' in data && data.error) || `HTTP ${res.status}`);
      }
      setTeamName(data.team_name);
      const initial: ScrapedRow[] = data.players.map(p => ({
        ...p,
        selected: true,
        utr_singles: null,
        utr_doubles: null,
        utr_status: 'idle',
      }));
      setRows(initial);

      if (initial.length > 0) {
        // Kick off UTR enrichment for each player in parallel but throttled.
        // We run max 3 lookups at once to avoid hammering UTR's search API.
        enrichUtr(initial);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to scrape team roster');
    } finally {
      setScraping(false);
    }
  };

  const enrichUtr = async (players: ScrapedRow[]) => {
    const CONCURRENCY = 3;
    const queue = players.map((p, idx) => ({ p, idx }));

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (!next) break;
        const { p, idx } = next;

        setRows(prev => {
          const copy = [...prev];
          if (copy[idx]) copy[idx] = { ...copy[idx], utr_status: 'loading' };
          return copy;
        });

        try {
          const res = await fetch('/api/courtconnect/utr-lookup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: p.name }),
          });
          const data = await res.json();
          // Take the first result's rating if the search returned any
          const first = data.results?.[0];
          const singles = first?.singlesUtr ?? null;
          const doubles = first?.doublesUtr ?? null;

          setRows(prev => {
            const copy = [...prev];
            if (copy[idx]) {
              copy[idx] = {
                ...copy[idx],
                utr_singles: singles,
                utr_doubles: doubles,
                utr_status: singles || doubles ? 'found' : 'not_found',
              };
            }
            return copy;
          });
        } catch {
          setRows(prev => {
            const copy = [...prev];
            if (copy[idx]) copy[idx] = { ...copy[idx], utr_status: 'error' };
            return copy;
          });
        }
      }
    });

    await Promise.all(workers);
  };

  const toggleRow = (idx: number) => {
    setRows(prev => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], selected: !copy[idx].selected };
      return copy;
    });
  };

  const toggleAll = () => {
    const anyUnselected = rows.some(r => !r.selected);
    setRows(prev => prev.map(r => ({ ...r, selected: anyUnselected })));
  };

  const selectedRows = rows.filter(r => r.selected);

  const handleImport = async () => {
    if (selectedRows.length === 0) return;
    setError(null);
    setImportResult(null);
    setImporting(true);

    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You must be signed in.');

      // Dedupe against existing vault rows by (director_id, full_name)
      const existingNames = new Set<string>();
      const { data: existing, error: existingErr } = await supabase
        .from('cc_vault_players')
        .select('full_name')
        .eq('director_id', user.id);
      if (existingErr) throw new Error(existingErr.message);
      existing?.forEach(r => existingNames.add(r.full_name.toLowerCase()));

      const toInsert = selectedRows
        .filter(r => !existingNames.has(r.name.toLowerCase()))
        .map(r => ({
          director_id: user.id,
          full_name: r.name,
          gender: r.gender,
          usta_rating: r.ntrp_numeric,
          utr_singles: r.utr_singles,
          utr_doubles: r.utr_doubles,
          utr_rating: r.utr_singles, // legacy column, keep in sync with singles
          rating_source: 'manual', // CHECK constraint limits to a known set; 'manual' is the safe default
          primary_sport: 'tennis',
          notes: teamName ? `Imported from ${teamName}` : 'Imported from USTA team page',
        }));

      const skipped = selectedRows.length - toInsert.length;

      if (toInsert.length > 0) {
        const { error: insertErr } = await supabase
          .from('cc_vault_players')
          .insert(toInsert);
        if (insertErr) throw new Error(insertErr.message);
      }

      setImportResult({ inserted: toInsert.length, skipped });
      // Clear selections so the user doesn't double-import on refresh
      setRows(prev => prev.map(r => ({ ...r, selected: false })));
    } catch (err: any) {
      setError(err?.message || 'Failed to import players');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/courtconnect/vault" className="btn btn-ghost btn-icon" aria-label="Back to vault">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-display">Import from USTA</h1>
          <p className="text-gray-500 text-sm">
            Paste a USTA NorCal team page URL and pull the full roster straight into your PlayerVault.
          </p>
        </div>
      </div>

      <div className="card p-5 mb-5">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          USTA NorCal team URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={e => setUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleScrape()}
            placeholder="https://leagues.ustanorcal.com/teaminfo.asp?id=108716"
            className="input flex-1 text-gray-900"
            disabled={scraping}
          />
          <button
            onClick={handleScrape}
            disabled={scraping || !url.trim()}
            className="btn btn-courtconnect"
          >
            {scraping ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {scraping ? 'Scraping...' : 'Pull roster'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Supports USTA NorCal today. TennisLink (national USTA) is a follow-up.
        </p>
      </div>

      {error && (
        <div className="alert alert-error mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {importResult && (
        <div className="alert alert-success mb-4 flex items-start gap-2">
          <CheckCircle size={16} className="mt-0.5 flex-shrink-0" />
          <span className="text-sm">
            Imported {importResult.inserted} player{importResult.inserted === 1 ? '' : 's'} to your vault.
            {importResult.skipped > 0 &&
              ` ${importResult.skipped} skipped (already in vault).`}
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-500">
              {teamName && <span className="font-medium text-white/70 mr-2">{teamName}</span>}
              {rows.length} player{rows.length === 1 ? '' : 's'} found
              {' · '}
              {selectedRows.length} selected
            </div>
            <button
              onClick={handleImport}
              disabled={importing || selectedRows.length === 0}
              className="btn btn-courtconnect btn-sm"
            >
              {importing ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />}
              {importing ? 'Importing...' : `Import ${selectedRows.length} to vault`}
            </button>
          </div>

          <div className="card overflow-hidden">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={rows.every(r => r.selected)}
                      onChange={toggleAll}
                      className="w-4 h-4"
                      aria-label="Toggle all"
                    />
                  </th>
                  <th>Name</th>
                  <th>City</th>
                  <th>Gender</th>
                  <th>NTRP</th>
                  <th>Singles UTR</th>
                  <th>Doubles UTR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.usta_player_id} className={r.selected ? '' : 'opacity-50'}>
                    <td onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={() => toggleRow(idx)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-sm text-gray-500">{r.city || '—'}</td>
                    <td className="text-sm text-gray-500">
                      {r.gender === 'male' ? 'M' : r.gender === 'female' ? 'F' : '—'}
                    </td>
                    <td className="text-sm">{r.ntrp || '—'}</td>
                    <td className="text-sm">
                      {r.utr_status === 'loading' && (
                        <Loader2 size={12} className="animate-spin inline" />
                      )}
                      {r.utr_status === 'found' && (r.utr_singles ?? '—')}
                      {r.utr_status === 'not_found' && <span className="text-gray-400">—</span>}
                      {r.utr_status === 'error' && <span className="text-red-400 text-xs">err</span>}
                      {r.utr_status === 'idle' && '—'}
                    </td>
                    <td className="text-sm">
                      {r.utr_status === 'found' && (r.utr_doubles ?? '—')}
                      {r.utr_status !== 'found' && (r.utr_status === 'loading' ? '' : '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!scraping && rows.length === 0 && !error && (
        <div className="card p-8 text-center text-gray-500">
          <Users size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm">Paste a team URL above to get started.</p>
          <p className="text-xs text-gray-400 mt-1">
            Example: <code className="text-gray-500">https://leagues.ustanorcal.com/teaminfo.asp?id=108716</code>
          </p>
        </div>
      )}
    </div>
  );
}

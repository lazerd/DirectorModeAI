'use client';

/**
 * Admin "Testing" tab.
 *
 * One-click seeder that creates a fully-populated fake league so the director
 * can QA the compass draw (and other league types) without inventing fake
 * people, and without any real emails being sent. The league's name is
 * prefixed with [TEST] so /api/leagues/[id]/generate-draws skips Resend
 * delivery, and all generated entries use @example.com addresses.
 *
 * Requires the admin to ALSO be signed in as a Supabase user (the league is
 * owned by that user so it shows up in their My Leagues list). If not, the
 * seeder endpoint returns 401 and we surface a friendly error.
 */

import { useState } from 'react';
import { Beaker, ExternalLink, AlertCircle, Check } from 'lucide-react';

type LeagueType = 'compass' | 'round_robin' | 'single_elimination';
type CategoryKey = 'men_singles' | 'men_doubles' | 'women_singles' | 'women_doubles';

type SeedResponse = {
  success?: boolean;
  leagueId?: string;
  leagueName?: string;
  leagueSlug?: string;
  url?: string;
  entriesCreated?: number;
  drawsGenerated?: boolean;
  drawsError?: string | null;
  error?: string;
};

export default function TestingTab() {
  const [size, setSize] = useState<8 | 16>(16);
  const [leagueType, setLeagueType] = useState<LeagueType>('compass');
  const [categoryKey, setCategoryKey] = useState<CategoryKey>('men_singles');
  const [generateDraws, setGenerateDraws] = useState(true);

  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<SeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<SeedResponse[]>([]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/leagues/seed-test-league', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ size, leagueType, categoryKey, generateDraws }),
      });
      const data: SeedResponse = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      setResult(data);
      setHistory((h) => [data, ...h].slice(0, 10));
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
        <div className="flex items-center gap-2 mb-1">
          <Beaker className="w-5 h-5 text-[#D3FB52]" />
          <h2 className="text-lg font-semibold text-white">Seed a test league</h2>
        </div>
        <p className="text-sm text-white/50 mb-5">
          Creates a fully-loaded fake league with {size} entries under your Supabase account so you can
          poke at the compass draw, score entry, and bracket progression without inventing 16 fake people
          every time. Name is prefixed with <code className="text-[#D3FB52]">[TEST]</code> so no emails
          are sent. Safe to delete afterward.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">League type</label>
            <select
              value={leagueType}
              onChange={(e) => setLeagueType(e.target.value as LeagueType)}
              className="w-full px-3 py-2 bg-[#001820] border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#D3FB52]/50"
              disabled={creating}
            >
              <option value="compass">Compass draw</option>
              <option value="single_elimination">Single elimination</option>
              <option value="round_robin">Round robin</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Field size</label>
            <select
              value={size}
              onChange={(e) => setSize(parseInt(e.target.value, 10) as 8 | 16)}
              className="w-full px-3 py-2 bg-[#001820] border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#D3FB52]/50"
              disabled={creating}
            >
              <option value={8}>8 players / teams</option>
              <option value={16}>16 players / teams</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-white/60 mb-1.5">Category</label>
            <select
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value as CategoryKey)}
              className="w-full px-3 py-2 bg-[#001820] border border-white/10 rounded-lg text-white focus:outline-none focus:border-[#D3FB52]/50"
              disabled={creating}
            >
              <option value="men_singles">Men&apos;s Singles</option>
              <option value="women_singles">Women&apos;s Singles</option>
              <option value="men_doubles">Men&apos;s Doubles</option>
              <option value="women_doubles">Women&apos;s Doubles</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-white/70 cursor-pointer">
              <input
                type="checkbox"
                checked={generateDraws}
                onChange={(e) => setGenerateDraws(e.target.checked)}
                disabled={creating}
                className="w-4 h-4 rounded border-white/20 bg-[#001820] accent-[#D3FB52]"
              />
              Also run draw generation now
            </label>
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={creating}
          className="mt-5 w-full sm:w-auto px-5 py-2.5 bg-[#D3FB52] text-[#001820] font-semibold rounded-lg hover:bg-[#D3FB52]/90 transition-colors disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create test league'}
        </button>

        {error && (
          <div className="mt-4 flex gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
            <div>{error}</div>
          </div>
        )}

        {result && result.success && (
          <div className="mt-4 flex flex-col gap-2 text-sm bg-[#D3FB52]/10 border border-[#D3FB52]/30 rounded-lg px-4 py-3">
            <div className="flex items-center gap-2 text-[#D3FB52] font-semibold">
              <Check size={16} />
              {result.leagueName}
            </div>
            <div className="text-white/60 text-xs">
              Created {result.entriesCreated} test entries.{' '}
              {result.drawsGenerated
                ? 'Draws generated — click through to view the bracket.'
                : result.drawsError
                  ? `Draws NOT generated: ${result.drawsError}`
                  : 'Draws NOT generated (skipped by request).'}
            </div>
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[#D3FB52] hover:underline w-fit"
              >
                Open league <ExternalLink size={12} />
              </a>
            )}
          </div>
        )}
      </div>

      {history.length > 1 && (
        <div className="rounded-xl border border-white/10 bg-[#002838] p-6">
          <h3 className="text-sm font-semibold text-white/70 mb-3">Recent test leagues (this session)</h3>
          <div className="space-y-2">
            {history.slice(1).map((h, i) => (
              <div
                key={`${h.leagueId}-${i}`}
                className="flex items-center justify-between gap-3 text-xs text-white/50 border border-white/5 rounded px-3 py-2"
              >
                <span className="truncate">{h.leagueName}</span>
                {h.url && (
                  <a
                    href={h.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#D3FB52] hover:underline flex-shrink-0"
                  >
                    Open <ExternalLink size={10} />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

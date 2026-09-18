'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trackEvent } from '@/lib/analytics';
import { ArrowLeft, Upload, FileText, Check, AlertCircle, Download, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  FIELD_LABEL,
  IMPORT_FIELDS,
  buildPlayers,
  detectMapping,
  parseCSV,
  planImport,
  summarizePlan,
  vaultColumns,
  type ColumnMapping,
  type DetectedMapping,
  type ImportField,
  type ImportedPlayer,
} from '@/lib/vault/csvImport';
import { TENNIS_SCALE, levelScaleFor, levelValue, type LevelScale } from '@/lib/levels';

const EXPECTED_HEADERS = ['name', 'email', 'phone', 'gender', 'age', 'ntrp', 'utr', 'sport', 'notes'];

const SOURCE_LABEL: Record<DetectedMapping['source'], string> = {
  wildapricot: 'Looks like a Wild Apricot export',
  template: 'PlayerVault template',
  generic: 'Columns matched by their headings',
  positional: 'No heading row — read in template column order',
};

/*
 * Two steps before anything is written: check the columns, then check the
 * people. Reading by position silently put a Wild Apricot "User ID" in the
 * name column; a mapping the director can see and fix is what stops that.
 */
export default function CSVImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<string[][]>([]);
  const [detected, setDetected] = useState<DetectedMapping | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>([]);
  const [step, setStep] = useState<'upload' | 'columns' | 'people'>('upload');
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [includeNoEmail, setIncludeNoEmail] = useState(false);
  const [existing, setExisting] = useState<Map<string, { id: string; notes: string | null }>>(new Map());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ summary: string; failed: number } | null>(null);
  const [fileName, setFileName] = useState('');
  // What the club calls a level, per sport — see lib/levels.ts.
  const [levels, setLevels] = useState<Record<string, LevelScale>>({});
  const [sports, setSports] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/clubs/levels');
        const json = await res.json();
        if (json.levels) setLevels(json.levels);
        if (json.sports) setSports(json.sports);
      } catch { /* not staff, or no club — the preview reads on the default scale */ }
    })();
  }, []);

  const reset = () => {
    setRows([]);
    setDetected(null);
    setMapping([]);
    setRemoved(new Set());
    setStep('upload');
    setFileName('');
    setImportResult(null);
  };

  // The director's existing vault, by email — the duplicate check. RLS scopes
  // this to their own rows ("Directors can manage own vault").
  useEffect(() => {
    if (step !== 'people') return;
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('cc_vault_players')
        .select('id, email, notes')
        .eq('director_id', user.id)
        .not('email', 'is', null);
      const m = new Map<string, { id: string; notes: string | null }>();
      for (const r of (data ?? []) as { id: string; email: string; notes: string | null }[]) {
        const e = r.email.trim().toLowerCase();
        if (e && !m.has(e)) m.set(e, { id: r.id, notes: r.notes });
      }
      setExisting(m);
    })();
  }, [step]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        reset();
        return;
      }
      const d = detectMapping(parsed[0]);
      setRows(parsed);
      setDetected(d);
      setMapping(d.mapping);
      setRemoved(new Set());
      setStep('columns');
    };
    reader.readAsText(file);
  };

  const players: ImportedPlayer[] = useMemo(
    () => (detected ? buildPlayers(rows, mapping, detected.hasHeader) : []),
    [rows, mapping, detected],
  );
  const kept = useMemo(() => players.filter((_, i) => !removed.has(i)), [players, removed]);
  const plan = useMemo(
    () => planImport(kept, new Map([...existing].map(([k, v]) => [k, v.id])), { includeNoEmail }),
    [kept, existing, includeNoEmail],
  );

  const setColumn = (col: number, field: ImportField | null) => {
    setMapping((prev) => {
      const next = [...prev];
      // A field feeds from one column; choosing it here releases it elsewhere.
      if (field) for (let i = 0; i < next.length; i++) if (next[i] === field) next[i] = null;
      next[col] = field;
      return next;
    });
  };

  const hasName = mapping.includes('full_name') || mapping.includes('first_name') || mapping.includes('last_name');

  const handleImport = async () => {
    if (plan.inserts.length + plan.updates.length === 0) return;

    setImporting(true);
    setImportResult(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setImporting(false); return; }

    let failed = 0;

    // Inserts in batches — one round trip per player made a 300-member
    // export take a minute.
    for (let i = 0; i < plan.inserts.length; i += 100) {
      const batch = plan.inserts.slice(i, i + 100).map((p) => ({
        director_id: user.id,
        ...vaultColumns(p, 'insert'),
      }));
      const { error } = await supabase.from('cc_vault_players').insert(batch);
      if (!error) continue;
      // One bad row fails the whole batch; retry singly so the rest still land.
      for (const row of batch) {
        const { error: rowError } = await supabase.from('cc_vault_players').insert(row);
        if (rowError) failed++;
      }
    }

    for (const { id, player } of plan.updates) {
      const cols = vaultColumns(player, 'update');
      // Membership details are appended to the notes a director already
      // wrote, and only when they are not already there.
      const prior = [...existing.values()].find((v) => v.id === id)?.notes ?? '';
      if (player.notes && !prior.includes(player.notes)) {
        cols.notes = prior ? `${prior}\n${player.notes}` : player.notes;
      }
      const { error } = await supabase
        .from('cc_vault_players')
        .update(cols)
        .eq('id', id)
        .eq('director_id', user.id);
      if (error) failed++;
    }

    const summary = summarizePlan(plan);
    trackEvent('feature_use', 'import_players', 'vault', {
      inserted: plan.inserts.length,
      updated: plan.updates.length,
      failed,
      source: detected?.source,
    });
    setImportResult({ summary, failed });
    setImporting(false);

    if (failed === 0) {
      setTimeout(() => router.push('/courtconnect/vault'), 2500);
    }
  };

  const downloadTemplate = () => {
    const csv = 'name,email,phone,gender,age,ntrp,utr,sport,notes\nJohn Smith,john@email.com,555-123-4567,M,35,4.0,8.5,tennis,Plays doubles\nJane Doe,jane@email.com,555-987-6543,F,28,3.5,,pickleball,Beginner\n';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playervault_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validCount = kept.filter((p) => p.valid).length;
  const invalidCount = kept.filter((p) => !p.valid).length;
  const header = detected?.hasHeader ? rows[0] : null;
  const samples = detected ? rows.slice(detected.hasHeader ? 1 : 0, (detected.hasHeader ? 1 : 0) + 3) : [];

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  /*
   * The FILE's columns keep their own names — `ntrp` is what the header says
   * and what a director's export will be called. What the club is shown is its
   * own word for a level (lib/levels.ts), so a pickleball club previews Novice
   * and Intermediate, not 2.0 and 2.75.
   */
  const clubScale = levels[sports[0] ?? 'tennis'] ?? TENNIS_SCALE;
  const scaleFor = (sport: string) => levels[sport] ?? levelScaleFor({ sport });
  const fieldLabel = (f: ImportField) => (f === 'usta_rating' ? clubScale.label : FIELD_LABEL[f]);

  const statusOf = (p: ImportedPlayer) => {
    if (!p.valid) return 'fix';
    if (!p.email) return includeNoEmail ? 'new' : 'skip';
    return existing.has(p.email) ? 'update' : 'new';
  };

  return (
    <div className="p-6 max-w-5xl mx-auto page-enter">
      <Link
        href="/courtconnect/vault"
        className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white mb-6"
      >
        <ArrowLeft size={16} />
        Back to PlayerVault
      </Link>

      <h1 className="text-2xl font-display text-white mb-2">CSV Import</h1>
      <p className="text-white/50 mb-6">
        Bring in players from any spreadsheet — a membership system export or our template. You check the
        columns and the people before anything is saved.
      </p>

      {step === 'upload' && (
        <>
          {/* Wild Apricot is the most common source for a club that keeps it for dues. */}
          <div className="card p-4 mb-6 border-[#D3FB52]/20">
            <p className="text-white/80 font-medium text-sm">Importing from Wild Apricot?</p>
            <p className="text-white/50 text-sm mt-1">
              Export your contacts: <b className="text-white/80">Contacts → Export</b> (choose CSV), then upload the
              file here. First and last names are joined, and membership level, status and join date are kept.
            </p>
          </div>

          {/* Template download */}
          <div className="card p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/80 font-medium text-sm">Starting from scratch?</p>
                <p className="text-white/40 text-xs">Download a CSV template with the usual columns.</p>
              </div>
              <button onClick={downloadTemplate} className="btn btn-sm bg-white/10 text-white hover:bg-white/20">
                <Download size={14} /> Download Template
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {EXPECTED_HEADERS.map(h => (
                <span key={h} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white/60 font-mono">
                  {h}
                </span>
              ))}
            </div>
            <p className="text-white/30 text-xs mt-2">
              Gender: M/F/NB. Sport: tennis, pickleball, padel, squash, badminton, racquetball, table tennis. The <span className="font-mono">ntrp</span> column takes 1.0-7.0. UTR: 1-16.5. A <span className="font-mono">dupr</span> column is read too (pickleball, 2.000-8.000).
            </p>
          </div>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="card p-12 text-center cursor-pointer hover:border-[#D3FB52]/30 transition-colors"
          >
            <Upload size={40} className="mx-auto text-white/20 mb-4" />
            <p className="text-white/70 font-medium mb-1">Click to upload a CSV file</p>
            <p className="text-white/40 text-sm">Any column order — we read the headings</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>
        </>
      )}

      {step !== 'upload' && detected && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <FileText size={18} className="text-[#D3FB52]" />
            <span className="text-white font-medium">{fileName}</span>
            <span className="text-white/40 text-sm">
              {players.length} rows · {SOURCE_LABEL[detected.source]}
            </span>
          </div>
          <button onClick={reset} className="btn btn-ghost btn-sm text-white/50">
            Choose another file
          </button>
        </div>
      )}

      {/* ------------------------------------------------ step 1: columns */}
      {step === 'columns' && detected && (
        <>
          <div className="card overflow-hidden mb-4">
            <div className="px-4 pt-4">
              <p className="text-white font-medium">1. Check the columns</p>
              <p className="text-white/40 text-sm">
                We matched what we could. Change any that are wrong, or set a column to &quot;Don&apos;t import&quot;.
              </p>
            </div>
            <div className="overflow-x-auto mt-3">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th>{header ? 'Column in your file' : 'Column'}</th>
                    <th>Example</th>
                    <th>Goes into</th>
                  </tr>
                </thead>
                <tbody>
                  {mapping.map((field, col) => (
                    <tr key={col}>
                      <td className="font-medium">{header ? header[col] || <span className="text-white/30">(blank)</span> : `Column ${col + 1}`}</td>
                      <td className="text-white/50 max-w-[260px] truncate">
                        {samples.map((r) => r[col]).filter(Boolean).slice(0, 2).join(' · ') || '—'}
                      </td>
                      <td>
                        <select
                          value={field ?? ''}
                          onChange={(e) => setColumn(col, (e.target.value || null) as ImportField | null)}
                          className="rounded-lg border border-white/10 bg-[#001820] px-2 py-1.5 text-sm"
                          style={{ color: '#ffffff' }}
                        >
                          <option value="">Don&apos;t import</option>
                          {IMPORT_FIELDS.map((f) => (
                            <option key={f} value={f}>{fieldLabel(f)}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {!hasName && (
            <p className="text-red-400 text-sm mb-3">Choose which column holds the name (or first and last name).</p>
          )}
          <p className="text-white/40 text-xs mb-4">
            Membership level and join date are saved in each player&apos;s notes; membership status is saved as
            active, inactive or guest.
          </p>
          <button
            onClick={() => setStep('people')}
            disabled={!hasName}
            className="btn bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] w-full btn-lg font-semibold"
          >
            Next: check the people
          </button>
        </>
      )}

      {/* ------------------------------------------------- step 2: people */}
      {step === 'people' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <button onClick={() => setStep('columns')} className="btn btn-ghost btn-sm text-white/60">
              ← Back to columns
            </button>
            <div className="flex items-center gap-3">
              {validCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-400 text-sm">
                  <Check size={14} /> {validCount} valid
                </span>
              )}
              {invalidCount > 0 && (
                <span className="flex items-center gap-1 text-red-400 text-sm">
                  <AlertCircle size={14} /> {invalidCount} need fixing
                </span>
              )}
            </div>
          </div>

          <div className="card p-4 mb-4">
            <p className="text-white font-medium">{summarizePlan(plan)}</p>
            <p className="text-white/40 text-sm mt-1">
              Someone already in your vault with the same email is updated, not added twice. Blank cells never
              erase what you already have.
            </p>
            {(plan.skippedNoEmail.length > 0 || includeNoEmail) && (
              <label className="mt-3 flex items-center gap-2 text-sm text-white/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeNoEmail}
                  onChange={(e) => setIncludeNoEmail(e.target.checked)}
                />
                Also add people with no email (they can&apos;t be checked for duplicates)
              </label>
            )}
          </div>

          <div className="card overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="table text-sm">
                <thead>
                  <tr>
                    <th className="w-8"></th>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Gender</th>
                    <th>{clubScale.label}</th>
                    <th>Sport</th>
                    <th>Membership</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player, i) => {
                    if (removed.has(i)) return null;
                    const s = statusOf(player);
                    return (
                      <tr key={i} className={!player.valid ? 'bg-red-500/5' : ''}>
                        <td>
                          {s === 'fix' ? (
                            <span title={player.error}><AlertCircle size={14} className="text-red-400" /></span>
                          ) : s === 'skip' ? (
                            <span className="text-[10px] uppercase text-white/40" title="No email">skip</span>
                          ) : s === 'update' ? (
                            <span className="text-[10px] uppercase text-sky-300" title="Already in your vault">update</span>
                          ) : (
                            <Check size={14} className="text-emerald-400" />
                          )}
                        </td>
                        <td className="font-medium">{player.full_name || <span className="text-red-400">Missing</span>}</td>
                        <td className="text-white/50">{player.email || '—'}</td>
                        <td className="text-white/50">{player.phone || '—'}</td>
                        <td className="text-white/50">{player.gender ? player.gender.charAt(0).toUpperCase() : '—'}</td>
                        <td>{player.usta_rating ? levelValue(scaleFor(player.primary_sport), player.usta_rating) : '—'}</td>
                        <td className="text-white/50">{sportLabel(player.primary_sport)}</td>
                        <td className="text-white/50 max-w-[240px] truncate" title={player.notes}>
                          {player.membership_status ?? (player.notes ? 'in notes' : '—')}
                        </td>
                        <td>
                          <button
                            onClick={() => setRemoved((prev) => new Set(prev).add(i))}
                            className="p-1 hover:bg-white/10 rounded text-white/30 hover:text-red-400"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {importResult && (
            <div className={`alert ${importResult.failed === 0 ? 'alert-success' : 'alert-warning'} mb-4`}>
              <p className="text-sm">
                Done — {importResult.summary}.
                {importResult.failed > 0 && ` ${importResult.failed} could not be saved.`}
                {importResult.failed === 0 && ' Taking you to your vault…'}
              </p>
            </div>
          )}

          <button
            onClick={handleImport}
            className="btn bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] w-full btn-lg font-semibold"
            disabled={importing || !!importResult || plan.inserts.length + plan.updates.length === 0}
          >
            {importing ? <div className="spinner" /> : (
              <><Upload size={18} /> Import: {plan.inserts.length} new, {plan.updates.length} updated</>
            )}
          </button>
        </>
      )}
    </div>
  );
}

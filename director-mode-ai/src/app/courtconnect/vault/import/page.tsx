'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { trackEvent } from '@/lib/analytics';
import { ArrowLeft, Upload, FileText, Check, AlertCircle, Download, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type ParsedPlayer = {
  full_name: string;
  email: string;
  phone: string;
  gender: string;
  age: string;
  usta_rating: string;
  utr_rating: string;
  primary_sport: string;
  notes: string;
  valid: boolean;
  error?: string;
};

const EXPECTED_HEADERS = ['name', 'email', 'phone', 'gender', 'age', 'ntrp', 'utr', 'sport', 'notes'];

const GENDER_MAP: Record<string, string> = {
  'm': 'male', 'male': 'male', 'man': 'male',
  'f': 'female', 'female': 'female', 'woman': 'female',
  'nb': 'non_binary', 'non-binary': 'non_binary', 'nonbinary': 'non_binary', 'non_binary': 'non_binary',
};

const SPORT_MAP: Record<string, string> = {
  'tennis': 'tennis', 't': 'tennis',
  'pickleball': 'pickleball', 'pb': 'pickleball', 'pickle': 'pickleball',
  'padel': 'padel',
  'squash': 'squash',
  'badminton': 'badminton',
  'racquetball': 'racquetball',
  'table tennis': 'table_tennis', 'table_tennis': 'table_tennis', 'tt': 'table_tennis', 'ping pong': 'table_tennis',
};

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = '';
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(current.trim());
        current = '';
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(current.trim());
        if (row.some(cell => cell.length > 0)) rows.push(row);
        row = [];
        current = '';
        if (ch === '\r') i++;
      } else {
        current += ch;
      }
    }
  }
  row.push(current.trim());
  if (row.some(cell => cell.length > 0)) rows.push(row);

  return rows;
}

function parseRow(cells: string[]): ParsedPlayer {
  const [name, email, phone, gender, age, ntrp, utr, sport, notes] = cells.map(c => (c || '').trim());

  const player: ParsedPlayer = {
    full_name: name || '',
    email: email || '',
    phone: phone || '',
    gender: GENDER_MAP[gender?.toLowerCase()] || '',
    age: age || '',
    usta_rating: ntrp || '',
    utr_rating: utr || '',
    primary_sport: SPORT_MAP[sport?.toLowerCase()] || 'tennis',
    notes: notes || '',
    valid: true,
  };

  if (!player.full_name) {
    player.valid = false;
    player.error = 'Name is required';
  }

  const ntrpNum = parseFloat(player.usta_rating);
  if (player.usta_rating && (isNaN(ntrpNum) || ntrpNum < 1 || ntrpNum > 7)) {
    player.valid = false;
    player.error = `Invalid NTRP: ${player.usta_rating}`;
  }

  const utrNum = parseFloat(player.utr_rating);
  if (player.utr_rating && (isNaN(utrNum) || utrNum < 1 || utrNum > 16.5)) {
    player.valid = false;
    player.error = `Invalid UTR: ${player.utr_rating}`;
  }

  return player;
}

export default function CSVImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsedPlayers, setParsedPlayers] = useState<ParsedPlayer[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; failed: number } | null>(null);
  const [fileName, setFileName] = useState('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setImportResult(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const rows = parseCSV(text);

      if (rows.length < 2) {
        setParsedPlayers([]);
        return;
      }

      // Skip header row
      const header = rows[0].map(h => h.toLowerCase().trim());
      const isHeader = header.some(h =>
        ['name', 'email', 'full_name', 'phone', 'gender', 'ntrp', 'utr', 'rating', 'sport'].includes(h)
      );

      const dataRows = isHeader ? rows.slice(1) : rows;
      const players = dataRows.map(row => parseRow(row));
      setParsedPlayers(players);
    };
    reader.readAsText(file);
  };

  const removePlayer = (index: number) => {
    setParsedPlayers(prev => prev.filter((_, i) => i !== index));
  };

  const handleImport = async () => {
    const validPlayers = parsedPlayers.filter(p => p.valid);
    if (validPlayers.length === 0) return;

    setImporting(true);
    setImportResult(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setImporting(false); return; }

    let success = 0;
    let failed = 0;

    for (const player of validPlayers) {
      const { error } = await supabase
        .from('cc_vault_players')
        .insert({
          director_id: user.id,
          full_name: player.full_name,
          email: player.email || null,
          phone: player.phone || null,
          gender: player.gender || null,
          age: player.age ? parseInt(player.age) : null,
          usta_rating: player.usta_rating ? parseFloat(player.usta_rating) : null,
          utr_rating: player.utr_rating ? parseFloat(player.utr_rating) : null,
          primary_sport: player.primary_sport || 'tennis',
          notes: player.notes || null,
          rating_source: 'manual',
        });

      if (error) {
        failed++;
      } else {
        success++;
      }
    }

    trackEvent('feature_use', 'import_players', 'vault', { success, failed });
    setImportResult({ success, failed });
    setImporting(false);

    if (failed === 0) {
      setTimeout(() => router.push('/courtconnect/vault'), 1500);
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

  const validCount = parsedPlayers.filter(p => p.valid).length;
  const invalidCount = parsedPlayers.filter(p => !p.valid).length;

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div className="p-6 max-w-4xl mx-auto page-enter">
      <Link
        href="/courtconnect/vault"
        className="inline-flex items-center gap-2 text-sm text-white/50 hover:text-white mb-6"
      >
        <ArrowLeft size={16} />
        Back to PlayerVault
      </Link>

      <h1 className="text-2xl font-display text-white mb-2">CSV Import</h1>
      <p className="text-white/50 mb-6">Bulk import players from a CSV file into your vault.</p>

      {/* Template download */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/80 font-medium text-sm">Need a template?</p>
            <p className="text-white/40 text-xs">Download a CSV template with the correct columns.</p>
          </div>
          <button onClick={downloadTemplate} className="btn btn-sm bg-white/10 text-white hover:bg-white/20">
            <Download size={14} /> Download Template
          </button>
        </div>
      </div>

      {/* Expected format */}
      <div className="card p-4 mb-6">
        <p className="text-white/60 text-sm mb-2 font-medium">Expected columns:</p>
        <div className="flex flex-wrap gap-2">
          {EXPECTED_HEADERS.map(h => (
            <span key={h} className="px-2 py-1 bg-white/5 border border-white/10 rounded text-xs text-white/60 font-mono">
              {h}
            </span>
          ))}
        </div>
        <p className="text-white/30 text-xs mt-2">
          Gender: M/F/NB. Sport: tennis, pickleball, padel, squash, badminton, racquetball, table tennis. NTRP: 1.0-7.0. UTR: 1-16.5.
        </p>
      </div>

      {/* File Upload */}
      {parsedPlayers.length === 0 && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="card p-12 text-center cursor-pointer hover:border-[#D3FB52]/30 transition-colors"
        >
          <Upload size={40} className="mx-auto text-white/20 mb-4" />
          <p className="text-white/70 font-medium mb-1">Click to upload a CSV file</p>
          <p className="text-white/40 text-sm">or drag and drop</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>
      )}

      {/* Preview */}
      {parsedPlayers.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <FileText size={18} className="text-[#D3FB52]" />
              <span className="text-white font-medium">{fileName}</span>
              <span className="text-white/40 text-sm">{parsedPlayers.length} rows</span>
            </div>
            <div className="flex items-center gap-3">
              {validCount > 0 && (
                <span className="flex items-center gap-1 text-emerald-400 text-sm">
                  <Check size={14} /> {validCount} valid
                </span>
              )}
              {invalidCount > 0 && (
                <span className="flex items-center gap-1 text-red-400 text-sm">
                  <AlertCircle size={14} /> {invalidCount} invalid
                </span>
              )}
              <button
                onClick={() => { setParsedPlayers([]); setFileName(''); setImportResult(null); }}
                className="btn btn-ghost btn-sm text-white/50"
              >
                Clear
              </button>
            </div>
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
                    <th>Age</th>
                    <th>NTRP</th>
                    <th>UTR</th>
                    <th>Sport</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {parsedPlayers.map((player, i) => (
                    <tr key={i} className={!player.valid ? 'bg-red-500/5' : ''}>
                      <td>
                        {player.valid ? (
                          <Check size={14} className="text-emerald-400" />
                        ) : (
                          <span title={player.error}><AlertCircle size={14} className="text-red-400" /></span>
                        )}
                      </td>
                      <td className="font-medium">{player.full_name || <span className="text-red-400">Missing</span>}</td>
                      <td className="text-white/50">{player.email || '—'}</td>
                      <td className="text-white/50">{player.phone || '—'}</td>
                      <td className="text-white/50">{player.gender ? player.gender.charAt(0).toUpperCase() : '—'}</td>
                      <td className="text-white/50">{player.age || '—'}</td>
                      <td>{player.usta_rating || '—'}</td>
                      <td>{player.utr_rating || '—'}</td>
                      <td className="text-white/50">{sportLabel(player.primary_sport)}</td>
                      <td>
                        <button onClick={() => removePlayer(i)} className="p-1 hover:bg-white/10 rounded text-white/30 hover:text-red-400">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Import result */}
          {importResult && (
            <div className={`alert ${importResult.failed === 0 ? 'alert-success' : 'alert-warning'} mb-4`}>
              <p className="text-sm">
                Imported {importResult.success} player{importResult.success !== 1 ? 's' : ''} successfully!
                {importResult.failed > 0 && ` ${importResult.failed} failed.`}
                {importResult.failed === 0 && ' Redirecting to vault...'}
              </p>
            </div>
          )}

          {/* Import button */}
          <button
            onClick={handleImport}
            className="btn bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] w-full btn-lg font-semibold"
            disabled={importing || validCount === 0}
          >
            {importing ? <div className="spinner" /> : (
              <><Upload size={18} /> Import {validCount} Player{validCount !== 1 ? 's' : ''} to Vault</>
            )}
          </button>
        </>
      )}
    </div>
  );
}

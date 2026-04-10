'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Upload, Users, Filter, Trash2, ArrowRightCircle, FileUp, Trophy } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const SPORTS = [
  { value: '', label: 'All Sports' },
  { value: 'tennis', label: 'Tennis' },
  { value: 'pickleball', label: 'Pickleball' },
  { value: 'padel', label: 'Padel' },
  { value: 'squash', label: 'Squash' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'table_tennis', label: 'Table Tennis' },
];

const GENDERS = [
  { value: '', label: 'All' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-Binary' },
];

type VaultPlayer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  gender: string | null;
  age: number | null;
  usta_rating: number | null;
  utr_singles: number | null;
  utr_doubles: number | null;
  primary_sport: string;
  membership_status: string;
  cc_player_id: string | null;
  notes: string | null;
  created_at: string;
};

type SortKey = 'name' | 'utr_singles_desc' | 'utr_singles_asc' | 'utr_doubles_desc' | 'utr_doubles_asc';

export default function PlayerVaultPage() {
  const [players, setPlayers] = useState<VaultPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sportFilter, setSportFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; skipped: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchPlayers();
  }, [sportFilter, genderFilter]);

  const fetchPlayers = async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    let query = supabase
      .from('cc_vault_players')
      .select('*')
      .eq('director_id', user.id)
      .order('full_name');

    if (sportFilter) query = query.eq('primary_sport', sportFilter);
    if (genderFilter) query = query.eq('gender', genderFilter);

    const { data } = await query;
    if (data) setPlayers(data);
    setLoading(false);
  };

  const filtered = players
    .filter(p =>
      !searchQuery ||
      p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.email?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .slice()
    .sort((a, b) => {
      // Null UTRs always sink to the bottom regardless of asc/desc so they
      // don't pollute the top of the rated list.
      const byRating = (av: number | null, bv: number | null, desc: boolean) => {
        if (av == null && bv == null) return a.full_name.localeCompare(b.full_name);
        if (av == null) return 1;
        if (bv == null) return -1;
        return desc ? bv - av : av - bv;
      };
      switch (sortKey) {
        case 'utr_singles_desc': return byRating(a.utr_singles, b.utr_singles, true);
        case 'utr_singles_asc':  return byRating(a.utr_singles, b.utr_singles, false);
        case 'utr_doubles_desc': return byRating(a.utr_doubles, b.utr_doubles, true);
        case 'utr_doubles_asc':  return byRating(a.utr_doubles, b.utr_doubles, false);
        case 'name':
        default:
          return a.full_name.localeCompare(b.full_name);
      }
    });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filtered.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filtered.map(p => p.id));
    }
  };

  const handleBulkImport = async () => {
    if (selectedIds.length === 0) return;
    setImporting(true);
    setImportResult(null);

    try {
      const res = await fetch('/api/courtconnect/vault-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vaultPlayerIds: selectedIds }),
      });
      const data = await res.json();
      setImportResult({ success: data.imported || 0, skipped: data.skipped || 0 });
      setSelectedIds([]);
      fetchPlayers();
    } catch (err) {
      setImportResult({ success: 0, skipped: 0 });
    }

    setImporting(false);
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`Delete ${selectedIds.length} player(s)? This cannot be undone.`)) return;

    setDeleting(true);
    const supabase = createClient();
    await supabase.from('cc_vault_players').delete().in('id', selectedIds);
    setSelectedIds([]);
    setDeleting(false);
    fetchPlayers();
  };

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const genderLabel = (g: string | null) => {
    if (!g) return '';
    return g === 'non_binary' ? 'NB' : g.charAt(0).toUpperCase();
  };

  const totalPlayers = players.length;
  const connectedPlayers = players.filter(p => p.cc_player_id).length;

  return (
    <div className="p-6 max-w-6xl mx-auto page-enter">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display">PlayerVault</h1>
          <p className="text-gray-500 mt-1">
            {totalPlayers} players &middot; {connectedPlayers} connected to CourtConnect
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/courtconnect/vault/import/usta" className="btn bg-white/10 text-white hover:bg-white/20">
            <Trophy size={18} />
            USTA Import
          </Link>
          <Link href="/courtconnect/vault/import" className="btn bg-white/10 text-white hover:bg-white/20">
            <FileUp size={18} />
            CSV Import
          </Link>
          <Link href="/courtconnect/vault/add" className="btn btn-courtconnect">
            <Plus size={18} />
            Add Player
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="card p-4 mb-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px] relative">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none z-10" />
            <input
              type="text"
              placeholder="Search by name or email..."
              className="input pl-10"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <select className="input w-auto" value={sportFilter} onChange={e => setSportFilter(e.target.value)}>
            {SPORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input w-auto" value={genderFilter} onChange={e => setGenderFilter(e.target.value)}>
            {GENDERS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
          <select
            className="input w-auto"
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            aria-label="Sort players"
          >
            <option value="name">Sort: Name</option>
            <option value="utr_singles_desc">Sort: Singles UTR (high → low)</option>
            <option value="utr_singles_asc">Sort: Singles UTR (low → high)</option>
            <option value="utr_doubles_desc">Sort: Doubles UTR (high → low)</option>
            <option value="utr_doubles_asc">Sort: Doubles UTR (low → high)</option>
          </select>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.length > 0 && (
        <div className="card p-3 mb-4 flex items-center gap-3 bg-courtconnect-light border-courtconnect/20">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <button
            onClick={handleBulkImport}
            className="btn btn-courtconnect btn-sm"
            disabled={importing}
          >
            {importing ? <div className="spinner" /> : (
              <><ArrowRightCircle size={14} /> Import to CourtConnect</>
            )}
          </button>
          <button
            onClick={handleBulkDelete}
            className="btn btn-destructive btn-sm"
            disabled={deleting}
          >
            <Trash2 size={14} /> Delete
          </button>
          <button onClick={() => setSelectedIds([])} className="btn btn-ghost btn-sm ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Import result */}
      {importResult && (
        <div className="alert alert-success mb-4">
          <p className="text-sm">
            Imported {importResult.success} player{importResult.success !== 1 ? 's' : ''} to CourtConnect.
            {importResult.skipped > 0 && ` ${importResult.skipped} already connected.`}
          </p>
        </div>
      )}

      {/* Player Table */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <Users size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">
            {players.length === 0 ? 'No players in your vault yet.' : 'No players match your filters.'}
          </p>
          {players.length === 0 && (
            <Link href="/courtconnect/vault/add" className="btn btn-courtconnect btn-sm">
              <Plus size={16} /> Add Your First Player
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead>
              <tr>
                <th className="w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === filtered.length && filtered.length > 0}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                </th>
                <th>Name</th>
                <th>Email</th>
                <th>Sport</th>
                <th>NTRP</th>
                <th>Singles UTR</th>
                <th>Doubles UTR</th>
                <th>Gender</th>
                <th>Age</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(player => (
                <tr key={player.id} className="cursor-pointer" onClick={() => toggleSelect(player.id)}>
                  <td onClick={e => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(player.id)}
                      onChange={() => toggleSelect(player.id)}
                      className="w-4 h-4 rounded border-gray-300"
                    />
                  </td>
                  <td>
                    <Link
                      href={`/courtconnect/vault/add?edit=${player.id}`}
                      className="font-medium text-courtconnect hover:underline"
                      onClick={e => e.stopPropagation()}
                    >
                      {player.full_name}
                    </Link>
                  </td>
                  <td className="text-gray-500 text-sm">{player.email || '—'}</td>
                  <td>
                    <span className="badge badge-courtconnect text-xs">{sportLabel(player.primary_sport)}</span>
                  </td>
                  <td className="text-sm">{player.usta_rating || '—'}</td>
                  <td className="text-sm">{player.utr_singles || '—'}</td>
                  <td className="text-sm">{player.utr_doubles || '—'}</td>
                  <td className="text-sm text-gray-500">{genderLabel(player.gender)}</td>
                  <td className="text-sm text-gray-500">{player.age || '—'}</td>
                  <td>
                    {player.cc_player_id ? (
                      <span className="badge badge-success text-xs">Connected</span>
                    ) : (
                      <span className="badge text-xs bg-gray-100 text-gray-500">Vault only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

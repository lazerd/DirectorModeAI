'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Users, Trash2, ArrowRightCircle, FileUp, Trophy, Crown, GraduationCap, User as UserIcon, Mail, Copy, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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

const ACCESS = [
  { value: '', label: 'Everyone' },
  { value: 'staff', label: 'Staff only' },
  { value: 'members', label: 'Has an account' },
  { value: 'roster', label: 'Roster only' },
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

// A person with a login account in this club (may or may not have a roster row).
type Member = { userId: string; role: string; isStaff: boolean; isOwner: boolean; name: string; email: string | null };
type Account = { userId: string; role: string; isStaff: boolean; isOwner: boolean };
// A unified row: a roster player, a member account, or both (matched by email).
type Row = VaultPlayer & { _account: Account | null; _memberOnly?: boolean };

type SortKey =
  | 'name_asc'
  | 'name_desc'
  | 'last_name_asc'
  | 'last_name_desc'
  | 'gender'
  | 'ntrp_desc'
  | 'ntrp_asc'
  | 'age_desc'
  | 'age_asc'
  | 'created_desc'
  | 'created_asc'
  | 'utr_singles_desc'
  | 'utr_singles_asc'
  | 'utr_doubles_desc'
  | 'utr_doubles_asc';

const getLastName = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', director: 'Director', coach: 'Coach', front_desk: 'Front desk', member: 'Member',
};

export default function PlayerVaultPage() {
  const [players, setPlayers] = useState<VaultPlayer[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [club, setClub] = useState<{ name: string; join_code: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sportFilter, setSportFilter] = useState('');
  const [genderFilter, setGenderFilter] = useState('');
  const [accessFilter, setAccessFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name_asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [importResult, setImportResult] = useState<{ success: number; skipped: number } | null>(null);
  const [savingRole, setSavingRole] = useState<string | null>(null);
  const [inviting, setInviting] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchPlayers();
  }, [sportFilter, genderFilter]);

  useEffect(() => {
    loadMembers();
  }, []);

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

  const loadMembers = async () => {
    try {
      const res = await fetch('/api/clubs/members');
      const json = await res.json();
      setClub(json.club || null);
      setMembers(json.members || []);
    } catch { /* no club / not staff — vault still works as a plain roster */ }
  };

  const joinUrl = club ? `${typeof window !== 'undefined' ? window.location.origin : 'https://club.coachmode.ai'}/join/${club.join_code}` : '';
  const copyJoin = () => { navigator.clipboard.writeText(joinUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  // Change a member's role (grant/remove staff access). Optimistic.
  async function setRole(userId: string, role: string) {
    setSavingRole(userId);
    const prev = members;
    setMembers((cur) => cur.map((m) => (m.userId === userId ? { ...m, role, isStaff: role !== 'member' } : m)));
    try {
      const res = await fetch('/api/clubs/members', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      toast.success(role === 'member' ? 'Staff access removed.' : `Now a ${ROLE_LABEL[role] || role}.`);
    } catch (e: any) {
      setMembers(prev);
      toast.error(e?.message || 'Could not change that role.');
    } finally {
      setSavingRole(null);
    }
  }

  // Email a roster-only player their invite link so they can create an account.
  async function invite(vaultId: string) {
    setInviting(vaultId);
    try {
      const res = await fetch('/api/clubs/invite-vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [vaultId] }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not send');
      toast.success(`Invite sent${json.capped ? ' (hit your monthly email limit — upgrade for more)' : ''}.`);
    } catch (e: any) {
      toast.error(e?.message || 'Could not send the invite.');
    } finally {
      setInviting(null);
    }
  }

  // ---- merge roster + accounts into one people list, keyed by email ----
  const memberByEmail = new Map<string, Member>();
  members.forEach((m) => { if (m.email) memberByEmail.set(m.email.toLowerCase(), m); });
  const rosterEmails = new Set(players.map((p) => p.email?.toLowerCase()).filter(Boolean) as string[]);

  const rosterRows: Row[] = players.map((p) => {
    const acct = p.email ? memberByEmail.get(p.email.toLowerCase()) : undefined;
    return { ...p, _account: acct ? { userId: acct.userId, role: acct.role, isStaff: acct.isStaff, isOwner: acct.isOwner } : null };
  });
  const memberOnlyRows: Row[] = members
    .filter((m) => !m.email || !rosterEmails.has(m.email.toLowerCase()))
    .map((m) => ({
      id: `member:${m.userId}`, full_name: m.name, email: m.email, phone: null, gender: null, age: null,
      usta_rating: null, utr_singles: null, utr_doubles: null, primary_sport: 'tennis',
      membership_status: 'active', cc_player_id: null, notes: null, created_at: '',
      _account: { userId: m.userId, role: m.role, isStaff: m.isStaff, isOwner: m.isOwner }, _memberOnly: true,
    }));
  const allRows: Row[] = [...rosterRows, ...memberOnlyRows];

  const filtered = allRows
    .filter((p) => !searchQuery || p.full_name.toLowerCase().includes(searchQuery.toLowerCase()) || p.email?.toLowerCase().includes(searchQuery.toLowerCase()))
    .filter((p) => {
      if (accessFilter === 'staff') return p._account?.isStaff;
      if (accessFilter === 'members') return !!p._account;
      if (accessFilter === 'roster') return !p._account;
      return true;
    })
    // member-only rows ignore the sport/gender DB filters (they have no ratings)
    .filter((p) => !(p._memberOnly && (sportFilter || genderFilter)))
    .slice()
    .sort((a, b) => {
      const byNum = (av: number | null, bv: number | null, desc: boolean) => {
        if (av == null && bv == null) return a.full_name.localeCompare(b.full_name);
        if (av == null) return 1;
        if (bv == null) return -1;
        return desc ? bv - av : av - bv;
      };
      const byStr = (av: string | null, bv: string | null, desc: boolean) => {
        if (!av && !bv) return a.full_name.localeCompare(b.full_name);
        if (!av) return 1;
        if (!bv) return -1;
        return desc ? bv.localeCompare(av) : av.localeCompare(bv);
      };
      switch (sortKey) {
        case 'name_asc':         return a.full_name.localeCompare(b.full_name);
        case 'name_desc':        return b.full_name.localeCompare(a.full_name);
        case 'last_name_asc':    return getLastName(a.full_name).localeCompare(getLastName(b.full_name));
        case 'last_name_desc':   return getLastName(b.full_name).localeCompare(getLastName(a.full_name));
        case 'gender':           return byStr(a.gender, b.gender, false);
        case 'ntrp_desc':        return byNum(a.usta_rating, b.usta_rating, true);
        case 'ntrp_asc':         return byNum(a.usta_rating, b.usta_rating, false);
        case 'age_desc':         return byNum(a.age, b.age, true);
        case 'age_asc':          return byNum(a.age, b.age, false);
        case 'created_desc':     return (b.created_at || '').localeCompare(a.created_at || '');
        case 'created_asc':      return (a.created_at || '').localeCompare(b.created_at || '');
        case 'utr_singles_desc': return byNum(a.utr_singles, b.utr_singles, true);
        case 'utr_singles_asc':  return byNum(a.utr_singles, b.utr_singles, false);
        case 'utr_doubles_desc': return byNum(a.utr_doubles, b.utr_doubles, true);
        case 'utr_doubles_asc':  return byNum(a.utr_doubles, b.utr_doubles, false);
        default:                 return a.full_name.localeCompare(b.full_name);
      }
    });

  // Only real roster rows are selectable for bulk import/delete.
  const selectableIds = filtered.filter((r) => !r._memberOnly).map((r) => r.id);
  const toggleSelect = (id: string) => setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  const toggleSelectAll = () => setSelectedIds(selectedIds.length === selectableIds.length ? [] : selectableIds);

  const handleBulkImport = async () => {
    if (selectedIds.length === 0) return;
    setImporting(true);
    setImportResult(null);
    try {
      const res = await fetch('/api/courtconnect/vault-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vaultPlayerIds: selectedIds }) });
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
    if (!confirm(`Delete ${selectedIds.length} roster player(s)? This removes their roster entry — it does not delete any member account. This cannot be undone.`)) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from('cc_vault_players').delete().in('id', selectedIds);
    setSelectedIds([]);
    setDeleting(false);
    fetchPlayers();
  };

  const sportLabel = (sport: string) => sport.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const genderLabel = (g: string | null) => (!g ? '' : g === 'non_binary' ? 'NB' : g.charAt(0).toUpperCase());
  const roleIcon = (r: string) =>
    r === 'owner' || r === 'director' ? <Crown className="h-3.5 w-3.5 text-yellow-500" />
    : r === 'coach' ? <GraduationCap className="h-3.5 w-3.5 text-violet-400" />
    : <UserIcon className="h-3.5 w-3.5 text-gray-400" />;

  const memberCount = allRows.filter((r) => r._account).length;
  const rosterOnly = allRows.filter((r) => !r._account).length;

  return (
    <div className="p-6 max-w-6xl mx-auto page-enter">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-display">PlayerVault</h1>
          <p className="text-gray-500 mt-1">
            Everyone at your club in one place — {allRows.length} people &middot; {memberCount} with a login &middot; {rosterOnly} roster only
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

      {/* Invite link — how people get a login account */}
      {club && (
        <div className="card p-4 mb-4">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2">
            <Mail size={16} className="text-courtconnect" /> Invite people to join {club.name}
          </div>
          <div className="flex items-center gap-2">
            <input readOnly value={joinUrl} onFocus={(e) => e.currentTarget.select()} className="input flex-1" style={{ color: '#e5e7eb' }} />
            <button onClick={copyJoin} className="btn btn-courtconnect btn-sm shrink-0">
              {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Anyone with this link gets a member login. Your subscription covers your whole team — give a director, coach, or front-desk person <strong>staff access</strong> in the Access column and they can run events and enter scores at no extra charge.
          </p>
        </div>
      )}

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
          <select className="input w-auto" value={accessFilter} onChange={e => setAccessFilter(e.target.value)} aria-label="Filter by access">
            {ACCESS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
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
            <optgroup label="Name">
              <option value="name_asc">Name (A → Z)</option>
              <option value="name_desc">Name (Z → A)</option>
              <option value="last_name_asc">Last name (A → Z)</option>
              <option value="last_name_desc">Last name (Z → A)</option>
            </optgroup>
            <optgroup label="Attributes">
              <option value="gender">Gender</option>
              <option value="age_desc">Age (oldest → youngest)</option>
              <option value="age_asc">Age (youngest → oldest)</option>
            </optgroup>
            <optgroup label="Ratings">
              <option value="ntrp_desc">NTRP (high → low)</option>
              <option value="ntrp_asc">NTRP (low → high)</option>
              <option value="utr_singles_desc">Singles UTR (high → low)</option>
              <option value="utr_singles_asc">Singles UTR (low → high)</option>
              <option value="utr_doubles_desc">Doubles UTR (high → low)</option>
              <option value="utr_doubles_asc">Doubles UTR (low → high)</option>
            </optgroup>
            <optgroup label="Added">
              <option value="created_desc">Date added (newest first)</option>
              <option value="created_asc">Date added (oldest first)</option>
            </optgroup>
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

      {/* People table */}
      {loading ? (
        <div className="flex justify-center py-12"><div className="spinner" /></div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <Users size={40} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-4">
            {allRows.length === 0 ? 'No one here yet — add players to your roster or share your invite link.' : 'No one matches your filters.'}
          </p>
          {allRows.length === 0 && (
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
                    checked={selectableIds.length > 0 && selectedIds.length === selectableIds.length}
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
                <th>Access</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(player => (
                <tr key={player.id} className={player._memberOnly ? '' : 'cursor-pointer'} onClick={() => !player._memberOnly && toggleSelect(player.id)}>
                  <td onClick={e => e.stopPropagation()}>
                    {!player._memberOnly && (
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(player.id)}
                        onChange={() => toggleSelect(player.id)}
                        className="w-4 h-4 rounded border-gray-300"
                      />
                    )}
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {player._memberOnly ? (
                        <span className="font-medium">{player.full_name}</span>
                      ) : (
                        <Link
                          href={`/courtconnect/vault/add?edit=${player.id}`}
                          className="font-medium text-courtconnect hover:underline"
                          onClick={e => e.stopPropagation()}
                        >
                          {player.full_name}
                        </Link>
                      )}
                      {player.cc_player_id && <span className="badge badge-success text-[10px]" title="Connected to CourtConnect">CC</span>}
                    </div>
                  </td>
                  <td className="text-gray-500 text-sm">{player.email || '—'}</td>
                  <td>
                    {player._memberOnly ? <span className="text-gray-500 text-sm">—</span> : <span className="badge badge-courtconnect text-xs">{sportLabel(player.primary_sport)}</span>}
                  </td>
                  <td className="text-sm">{player.usta_rating || '—'}</td>
                  <td className="text-sm">{player.utr_singles || '—'}</td>
                  <td className="text-sm">{player.utr_doubles || '—'}</td>
                  <td className="text-sm text-gray-500">{genderLabel(player.gender)}</td>
                  <td className="text-sm text-gray-500">{player.age || '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {player._account ? (
                      player._account.isOwner ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                          <Crown className="h-3.5 w-3.5 text-yellow-500" /> Owner · pays
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          {roleIcon(player._account.role)}
                          <select
                            value={player._account.role}
                            disabled={savingRole === player._account.userId}
                            onChange={e => setRole(player._account!.userId, e.target.value)}
                            className="text-xs px-2 py-1 rounded-lg border"
                            style={{ color: '#111827', backgroundColor: '#fff' }}
                          >
                            <option value="director">Director — full access</option>
                            <option value="coach">Coach / pro — run events</option>
                            <option value="front_desk">Front desk — run events</option>
                            <option value="member">Member — player access</option>
                          </select>
                        </span>
                      )
                    ) : player.email ? (
                      <button
                        onClick={() => invite(player.id)}
                        disabled={inviting === player.id}
                        className="btn btn-ghost btn-sm text-xs"
                        title="Email this player an invite to create a login"
                      >
                        {inviting === player.id ? <Loader2 size={13} className="animate-spin" /> : <><Mail size={13} /> Invite</>}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-400">Roster only</span>
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

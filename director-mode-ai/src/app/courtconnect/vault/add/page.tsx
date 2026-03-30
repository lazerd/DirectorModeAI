'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Search, Save, Plus, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const SPORTS = [
  { value: 'tennis', label: 'Tennis' },
  { value: 'pickleball', label: 'Pickleball' },
  { value: 'padel', label: 'Padel' },
  { value: 'squash', label: 'Squash' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'table_tennis', label: 'Table Tennis' },
];

const GENDERS = [
  { value: '', label: 'Select...' },
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-Binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];

type UTRResult = {
  displayName: string;
  singlesUtr: number | null;
  doublesUtr: number | null;
  location: string | null;
  utrId: string;
};

export default function AddVaultPlayerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [error, setError] = useState('');

  // UTR Lookup
  const [utrSearchName, setUtrSearchName] = useState('');
  const [utrSearching, setUtrSearching] = useState(false);
  const [utrResults, setUtrResults] = useState<UTRResult[]>([]);
  // UTR search is always visible

  // Form
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    gender: '',
    date_of_birth: '',
    age: '',
    usta_rating: '',
    utr_rating: '',
    utr_id: '',
    primary_sport: 'tennis',
    membership_status: 'active',
    notes: '',
  });

  useEffect(() => {
    if (editId) fetchPlayer();
  }, [editId]);

  const fetchPlayer = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('cc_vault_players')
      .select('*')
      .eq('id', editId)
      .single();

    if (data) {
      setForm({
        full_name: data.full_name || '',
        email: data.email || '',
        phone: data.phone || '',
        gender: data.gender || '',
        date_of_birth: data.date_of_birth || '',
        age: data.age?.toString() || '',
        usta_rating: data.usta_rating?.toString() || '',
        utr_rating: data.utr_rating?.toString() || '',
        utr_id: data.utr_id || '',
        primary_sport: data.primary_sport || 'tennis',
        membership_status: data.membership_status || 'active',
        notes: data.notes || '',
      });
    }
    setLoading(false);
  };

  const updateForm = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleUtrSearch = async () => {
    if (!utrSearchName.trim()) return;
    setUtrSearching(true);
    setUtrResults([]);

    try {
      const res = await fetch('/api/courtconnect/utr-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: utrSearchName }),
      });
      const data = await res.json();
      if (data.results) setUtrResults(data.results);
    } catch (err) {
      console.error('UTR search failed:', err);
    }

    setUtrSearching(false);
  };

  const selectUtrPlayer = (result: UTRResult) => {
    setForm(prev => ({
      ...prev,
      full_name: prev.full_name || result.displayName,
      utr_rating: result.singlesUtr?.toString() || result.doublesUtr?.toString() || '',
      utr_id: result.utrId,
    }));
    setUtrResults([]);
    setUtrSearchName('');
  };

  const handleSave = async (addAnother: boolean = false) => {
    setError('');
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not logged in'); setSaving(false); return; }

    const playerData = {
      director_id: user.id,
      full_name: form.full_name,
      email: form.email || null,
      phone: form.phone || null,
      gender: form.gender || null,
      date_of_birth: form.date_of_birth || null,
      age: form.age ? parseInt(form.age) : null,
      usta_rating: form.usta_rating ? parseFloat(form.usta_rating) : null,
      utr_rating: form.utr_rating ? parseFloat(form.utr_rating) : null,
      utr_id: form.utr_id || null,
      rating_source: form.utr_id ? 'utr_api' : 'manual',
      primary_sport: form.primary_sport,
      membership_status: form.membership_status,
      notes: form.notes || null,
    };

    if (editId) {
      const { error: updateError } = await supabase
        .from('cc_vault_players')
        .update(playerData)
        .eq('id', editId);
      if (updateError) { setError(updateError.message); setSaving(false); return; }
    } else {
      const { error: insertError } = await supabase
        .from('cc_vault_players')
        .insert(playerData);
      if (insertError) { setError(insertError.message); setSaving(false); return; }
    }

    setSaving(false);

    if (addAnother) {
      // Reset form but keep sport and membership status
      setForm(prev => ({
        full_name: '',
        email: '',
        phone: '',
        gender: '',
        date_of_birth: '',
        age: '',
        usta_rating: '',
        utr_rating: '',
        utr_id: '',
        primary_sport: prev.primary_sport,
        membership_status: prev.membership_status,
        notes: '',
      }));
    } else {
      router.push('/courtconnect/vault');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto page-enter">
      <Link
        href="/courtconnect/vault"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={16} />
        Back to PlayerVault
      </Link>

      <h1 className="text-2xl font-display mb-6">
        {editId ? 'Edit Player' : 'Add Player'}
      </h1>

      {error && (
        <div className="alert alert-error mb-6"><p>{error}</p></div>
      )}

      {/* UTR Lookup — always visible */}
      <div className="card p-5 mb-6 border-[#D3FB52]/20">
        <div className="flex items-center gap-2 mb-3">
          <Search size={18} className="text-[#D3FB52]" />
          <h2 className="font-semibold text-white">Auto-Import from UTR</h2>
        </div>
        <p className="text-white/40 text-sm mb-3">Search a player&apos;s name to pull their UTR rating automatically.</p>

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            className="input flex-1"
            placeholder="Search player name on UTR..."
            value={utrSearchName}
            onChange={e => setUtrSearchName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleUtrSearch()}
          />
          <button
            onClick={handleUtrSearch}
            className="btn bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] btn-sm font-semibold"
            disabled={utrSearching}
          >
            {utrSearching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            Search UTR
          </button>
        </div>

        {utrResults.length > 0 && (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {utrResults.map(result => (
              <button
                key={result.utrId}
                onClick={() => selectUtrPlayer(result)}
                className="w-full text-left p-3 bg-white/[0.03] border border-white/[0.06] rounded-lg hover:border-[#D3FB52]/30 hover:bg-[#D3FB52]/5 transition-colors"
              >
                <div className="font-medium text-white">{result.displayName}</div>
                <div className="text-sm text-white/50">
                  {result.singlesUtr && `Singles UTR: ${result.singlesUtr}`}
                  {result.doublesUtr && ` | Doubles UTR: ${result.doublesUtr}`}
                  {result.location && ` | ${result.location}`}
                </div>
              </button>
            ))}
          </div>
        )}

        {utrSearching && (
          <p className="text-sm text-white/30 text-center py-2">Searching UTR...</p>
        )}

        {utrResults.length === 0 && !utrSearching && utrSearchName.length > 2 && (
          <p className="text-xs text-white/30 mt-1">Type a name and click Search UTR to find players.</p>
        )}
      </div>

      {/* Player Form */}
      <div className="card p-6 space-y-5">
        {/* Name & Email */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Full Name *</label>
            <input
              type="text"
              className="input"
              value={form.full_name}
              onChange={e => updateForm('full_name', e.target.value)}
              placeholder="Player name"
              required
            />
          </div>
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input"
              value={form.email}
              onChange={e => updateForm('email', e.target.value)}
              placeholder="player@email.com"
            />
          </div>
        </div>

        {/* Phone & Gender */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Phone</label>
            <input
              type="tel"
              className="input"
              value={form.phone}
              onChange={e => updateForm('phone', e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="label">Gender</label>
            <select
              className="input"
              value={form.gender}
              onChange={e => updateForm('gender', e.target.value)}
            >
              {GENDERS.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
        </div>

        {/* Age & DOB */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Date of Birth</label>
            <input
              type="date"
              className="input"
              value={form.date_of_birth}
              onChange={e => updateForm('date_of_birth', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Age</label>
            <input
              type="number"
              className="input"
              min={5}
              max={100}
              value={form.age}
              onChange={e => updateForm('age', e.target.value)}
              placeholder="Auto-calculated or manual"
            />
          </div>
        </div>

        {/* Ratings */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">USTA/NTRP Rating (1.0 - 7.0)</label>
            <input
              type="number"
              className="input"
              min={1.0}
              max={7.0}
              step={0.5}
              value={form.usta_rating}
              onChange={e => updateForm('usta_rating', e.target.value)}
              placeholder="e.g. 4.0"
            />
          </div>
          <div>
            <label className="label">
              UTR Rating (1 - 16.5)
              {form.utr_id && <span className="text-xs text-courtconnect ml-2">via UTR lookup</span>}
            </label>
            <input
              type="number"
              className="input"
              min={1}
              max={16.5}
              step={0.01}
              value={form.utr_rating}
              onChange={e => updateForm('utr_rating', e.target.value)}
              placeholder="e.g. 8.50"
            />
          </div>
        </div>

        {/* Sport & Status */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Primary Sport</label>
            <select
              className="input"
              value={form.primary_sport}
              onChange={e => updateForm('primary_sport', e.target.value)}
            >
              {SPORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Membership Status</label>
            <select
              className="input"
              value={form.membership_status}
              onChange={e => updateForm('membership_status', e.target.value)}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="guest">Guest</option>
            </select>
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes</label>
          <textarea
            className="input"
            value={form.notes}
            onChange={e => updateForm('notes', e.target.value)}
            placeholder="Any notes about this player..."
            rows={2}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => handleSave(false)}
            className="btn btn-courtconnect flex-1 btn-lg"
            disabled={saving || !form.full_name}
          >
            {saving ? <div className="spinner" /> : (
              <><Save size={18} /> {editId ? 'Save Changes' : 'Add Player'}</>
            )}
          </button>
          {!editId && (
            <button
              onClick={() => handleSave(true)}
              className="btn btn-ghost btn-lg"
              disabled={saving || !form.full_name}
            >
              <Plus size={18} /> Save & Add Another
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

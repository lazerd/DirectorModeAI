'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Save, ExternalLink, Copy, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

const SPORTS_OPTIONS = [
  { value: 'tennis', label: 'Tennis' },
  { value: 'pickleball', label: 'Pickleball' },
  { value: 'padel', label: 'Padel' },
  { value: 'squash', label: 'Squash' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'table_tennis', label: 'Table Tennis' },
];

export default function ClubSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clubId, setClubId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    website: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    sports: ['tennis'] as string[],
    is_public: true,
    accept_join_requests: true,
  });

  useEffect(() => { fetchClub(); }, []);

  const fetchClub = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data: club } = await supabase
      .from('cc_clubs')
      .select('*')
      .eq('owner_id', user.id)
      .single();

    if (club) {
      setClubId(club.id);
      setForm({
        name: club.name || '',
        slug: club.slug || '',
        description: club.description || '',
        website: club.website || '',
        phone: club.phone || '',
        email: club.email || '',
        address: club.address || '',
        city: club.city || '',
        state: club.state || '',
        zip: club.zip || '',
        sports: club.sports || ['tennis'],
        is_public: club.is_public ?? true,
        accept_join_requests: club.accept_join_requests ?? true,
      });
    } else {
      // Pre-fill with profile data
      const { data: profile } = await supabase
        .from('profiles')
        .select('email, organization_name')
        .eq('id', user.id)
        .single();
      if (profile) {
        setForm(prev => ({
          ...prev,
          name: profile.organization_name || '',
          email: profile.email || '',
        }));
      }
    }

    setLoading(false);
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  };

  const updateForm = (field: string, value: any) => {
    setForm(prev => {
      const updated = { ...prev, [field]: value };
      if (field === 'name' && !clubId) {
        updated.slug = generateSlug(value);
      }
      return updated;
    });
  };

  const toggleSport = (sport: string) => {
    setForm(prev => ({
      ...prev,
      sports: prev.sports.includes(sport)
        ? prev.sports.filter(s => s !== sport)
        : [...prev.sports, sport],
    }));
  };

  const handleSave = async () => {
    if (!form.name || !form.slug) return;
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    const clubData = {
      owner_id: user.id,
      name: form.name,
      slug: form.slug,
      description: form.description || null,
      website: form.website || null,
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      city: form.city || null,
      state: form.state || null,
      zip: form.zip || null,
      sports: form.sports,
      is_public: form.is_public,
      accept_join_requests: form.accept_join_requests,
    };

    if (clubId) {
      await supabase.from('cc_clubs').update(clubData).eq('id', clubId);
    } else {
      const { data } = await supabase.from('cc_clubs').insert(clubData).select().single();
      if (data) setClubId(data.id);
    }

    setSaving(false);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(`https://club.coachmode.ai/club/${form.slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><div className="spinner" /></div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto page-enter">
      <h1 className="text-2xl font-display text-white mb-2">
        {clubId ? 'Edit Club Profile' : 'Create Club Profile'}
      </h1>
      <p className="text-white/50 mb-6">Set up your public club page so players can find you.</p>

      {/* Public URL preview */}
      {form.slug && (
        <div className="card p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="text-white/40 text-xs mb-1">Your public URL</p>
            <p className="text-[#D3FB52] text-sm font-mono">club.coachmode.ai/club/{form.slug}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={copyUrl} className="btn btn-sm bg-white/10 text-white hover:bg-white/20">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            {clubId && (
              <Link href={`/club/${form.slug}`} target="_blank" className="btn btn-sm bg-white/10 text-white hover:bg-white/20">
                <ExternalLink size={14} /> Preview
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Basic Info */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-white">Basic Info</h2>
          <div>
            <label className="label text-white/70">Club Name *</label>
            <input type="text" className="input" value={form.name} onChange={e => updateForm('name', e.target.value)} placeholder="Your club name" />
          </div>
          <div>
            <label className="label text-white/70">URL Slug *</label>
            <div className="flex items-center gap-2">
              <span className="text-white/30 text-sm">club.coachmode.ai/club/</span>
              <input type="text" className="input flex-1" value={form.slug} onChange={e => updateForm('slug', e.target.value)} placeholder="your-club" />
            </div>
          </div>
          <div>
            <label className="label text-white/70">Description</label>
            <textarea className="input" rows={3} value={form.description} onChange={e => updateForm('description', e.target.value)} placeholder="Tell players about your club..." />
          </div>
        </div>

        {/* Sports */}
        <div className="card p-6">
          <h2 className="font-semibold text-white mb-4">Sports Offered</h2>
          <div className="flex flex-wrap gap-2">
            {SPORTS_OPTIONS.map(sport => (
              <button
                key={sport.value}
                onClick={() => toggleSport(sport.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  form.sports.includes(sport.value)
                    ? 'bg-[#D3FB52] text-[#002838]'
                    : 'bg-white/5 text-white/50 hover:bg-white/10'
                }`}
              >
                {sport.label}
              </button>
            ))}
          </div>
        </div>

        {/* Contact */}
        <div className="card p-6 space-y-4">
          <h2 className="font-semibold text-white">Contact & Location</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label text-white/70">Email</label>
              <input type="email" className="input" value={form.email} onChange={e => updateForm('email', e.target.value)} placeholder="info@yourclub.com" />
            </div>
            <div>
              <label className="label text-white/70">Phone</label>
              <input type="tel" className="input" value={form.phone} onChange={e => updateForm('phone', e.target.value)} placeholder="(555) 123-4567" />
            </div>
          </div>
          <div>
            <label className="label text-white/70">Website</label>
            <input type="url" className="input" value={form.website} onChange={e => updateForm('website', e.target.value)} placeholder="https://yourclub.com" />
          </div>
          <div>
            <label className="label text-white/70">Address</label>
            <input type="text" className="input" value={form.address} onChange={e => updateForm('address', e.target.value)} placeholder="123 Tennis Way" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label text-white/70">City</label>
              <input type="text" className="input" value={form.city} onChange={e => updateForm('city', e.target.value)} />
            </div>
            <div>
              <label className="label text-white/70">State</label>
              <input type="text" className="input" value={form.state} onChange={e => updateForm('state', e.target.value)} />
            </div>
            <div>
              <label className="label text-white/70">ZIP</label>
              <input type="text" className="input" value={form.zip} onChange={e => updateForm('zip', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="card p-6 space-y-3">
          <h2 className="font-semibold text-white mb-2">Settings</h2>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.is_public} onChange={e => updateForm('is_public', e.target.checked)} className="w-4 h-4 rounded" />
            <div>
              <span className="font-medium text-sm text-white">Public profile</span>
              <p className="text-xs text-white/40">Visible to anyone with the link</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.accept_join_requests} onChange={e => updateForm('accept_join_requests', e.target.checked)} className="w-4 h-4 rounded" />
            <div>
              <span className="font-medium text-sm text-white">Accept join requests</span>
              <p className="text-xs text-white/40">Show &quot;Join this club&quot; button on public page</p>
            </div>
          </label>
        </div>

        <button onClick={handleSave} className="btn bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] w-full btn-lg font-semibold" disabled={saving || !form.name || !form.slug}>
          {saving ? <div className="spinner" /> : <><Save size={18} /> {clubId ? 'Save Changes' : 'Create Club'}</>}
        </button>
      </div>
    </div>
  );
}

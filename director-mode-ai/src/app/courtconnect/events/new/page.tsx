'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { trackEvent } from '@/lib/analytics';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

const SPORTS = [
  { value: 'tennis', label: 'Tennis' },
  { value: 'pickleball', label: 'Pickleball' },
  { value: 'padel', label: 'Padel' },
  { value: 'squash', label: 'Squash' },
  { value: 'badminton', label: 'Badminton' },
  { value: 'racquetball', label: 'Racquetball' },
  { value: 'table_tennis', label: 'Table Tennis' },
];

const EVENT_TYPES = [
  { value: 'doubles', label: 'Doubles Match' },
  { value: 'singles', label: 'Singles Match' },
  { value: 'clinic', label: 'Clinic' },
  { value: 'social', label: 'Social Play' },
  { value: 'practice', label: 'Practice Session' },
  { value: 'tournament', label: 'Tournament' },
  { value: 'open_play', label: 'Open Play' },
];

export default function CreateEventPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [form, setForm] = useState({
    title: '',
    description: '',
    event_type: 'doubles',
    sport: 'tennis',
    event_date: '',
    start_time: '',
    end_time: '',
    location: '',
    court_count: 1,
    max_players: 4,
    auto_close: true,
    skill_min: '',
    skill_max: '',
    is_public: true,
  });

  const updateForm = (field: string, value: string | number | boolean) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setError('You must be logged in to create an event.');
      setSaving(false);
      return;
    }

    const { data, error: insertError } = await supabase
      .from('cc_events')
      .insert({
        created_by: user.id,
        title: form.title,
        description: form.description || null,
        event_type: form.event_type,
        sport: form.sport,
        event_date: form.event_date,
        start_time: form.start_time,
        end_time: form.end_time || null,
        location: form.location || null,
        court_count: form.court_count,
        max_players: form.max_players,
        auto_close: form.auto_close,
        skill_min: form.skill_min ? parseFloat(form.skill_min) : null,
        skill_max: form.skill_max ? parseFloat(form.skill_max) : null,
        is_public: form.is_public,
      })
      .select()
      .single();

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    trackEvent('feature_use', 'create_event', 'courtconnect');
    router.push(`/courtconnect/events/${data.id}`);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto page-enter">
      <Link
        href="/courtconnect/home"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={16} />
        Back to Dashboard
      </Link>

      <h1 className="text-2xl font-display mb-6">Create Event</h1>

      {error && (
        <div className="alert alert-error mb-6">
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {/* Title */}
        <div>
          <label className="label">Event Title *</label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Saturday Doubles at Central Park"
            value={form.title}
            onChange={e => updateForm('title', e.target.value)}
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className="label">Description</label>
          <textarea
            className="input"
            placeholder="Tell players what to expect..."
            value={form.description}
            onChange={e => updateForm('description', e.target.value)}
            rows={3}
          />
        </div>

        {/* Sport & Type */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Sport *</label>
            <select
              className="input"
              value={form.sport}
              onChange={e => updateForm('sport', e.target.value)}
            >
              {SPORTS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Event Type *</label>
            <select
              className="input"
              value={form.event_type}
              onChange={e => updateForm('event_type', e.target.value)}
            >
              {EVENT_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Date *</label>
            <input
              type="date"
              className="input"
              value={form.event_date}
              onChange={e => updateForm('event_date', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">Start Time *</label>
            <input
              type="time"
              className="input"
              value={form.start_time}
              onChange={e => updateForm('start_time', e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">End Time</label>
            <input
              type="time"
              className="input"
              value={form.end_time}
              onChange={e => updateForm('end_time', e.target.value)}
            />
          </div>
        </div>

        {/* Location */}
        <div>
          <label className="label">Location</label>
          <input
            type="text"
            className="input"
            placeholder="e.g. Central Park Tennis Courts"
            value={form.location}
            onChange={e => updateForm('location', e.target.value)}
          />
        </div>

        {/* Courts & Players */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Courts</label>
            <input
              type="number"
              className="input"
              min={1}
              max={20}
              value={form.court_count}
              onChange={e => updateForm('court_count', parseInt(e.target.value) || 1)}
            />
          </div>
          <div>
            <label className="label">Max Players *</label>
            <input
              type="number"
              className="input"
              min={2}
              max={100}
              value={form.max_players}
              onChange={e => updateForm('max_players', parseInt(e.target.value) || 4)}
              required
            />
          </div>
        </div>

        {/* Skill Range */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Min NTRP Level</label>
            <input
              type="number"
              className="input"
              min={1.0}
              max={7.0}
              step={0.5}
              placeholder="e.g. 3.0"
              value={form.skill_min}
              onChange={e => updateForm('skill_min', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Max NTRP Level</label>
            <input
              type="number"
              className="input"
              min={1.0}
              max={7.0}
              step={0.5}
              placeholder="e.g. 4.5"
              value={form.skill_max}
              onChange={e => updateForm('skill_max', e.target.value)}
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.auto_close}
              onChange={e => updateForm('auto_close', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-courtconnect focus:ring-courtconnect"
            />
            <div>
              <span className="font-medium text-sm">Auto-close when full</span>
              <p className="text-xs text-gray-500">First {form.max_players} to accept get spots, rest go to waitlist</p>
            </div>
          </label>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_public}
              onChange={e => updateForm('is_public', e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-courtconnect focus:ring-courtconnect"
            />
            <div>
              <span className="font-medium text-sm">Public event</span>
              <p className="text-xs text-gray-500">Visible on the event board for anyone to browse</p>
            </div>
          </label>
        </div>

        {/* Submit */}
        <button
          type="submit"
          className="btn btn-courtconnect w-full btn-lg"
          disabled={saving}
        >
          {saving ? <div className="spinner" /> : 'Create Event'}
        </button>
      </form>
    </div>
  );
}

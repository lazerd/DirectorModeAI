'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { GraduationCap, Sparkles, Loader2, Save } from 'lucide-react';

const SKILLS = ['Serve', 'Forehand', 'Backhand', 'Volley', 'Movement', 'Strategy'];

export default function CoachModeRecapPage() {
  const [playerName, setPlayerName] = useState('');
  const [focusArea, setFocusArea] = useState('');
  const [content, setContent] = useState('');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [summary, setSummary] = useState('');
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const skills = Object.entries(ratings).map(([skill, rating]) => ({ skill, rating }));

  const generate = async () => {
    if (!content.trim()) {
      toast.error('Add a few notes about the lesson first.');
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch('/api/lessons/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerName, focusArea, content, skills }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || 'Could not generate summary');
      setSummary(json.summary);
    } catch (err: any) {
      toast.error(err?.message || 'Could not generate summary.');
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in.');
      const { data: coach } = await supabase
        .from('lesson_coaches')
        .select('*')
        .eq('profile_id', user.id)
        .maybeSingle();
      if (!coach) throw new Error('Set up your coach profile first (Lessons → Settings).');

      const res = await fetch('/api/lessons/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerName, focusArea, content, skills,
          coachId: coach.id, clubId: (coach as any).club_id ?? null,
          persist: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || 'Could not save');
      setSummary(json.summary);
      toast.success(json.noteId ? 'Lesson saved to the player’s record.' : 'Summary generated (saving enabled after setup).');
    } catch (err: any) {
      toast.error(err?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 focus:outline-none focus:ring-2 focus:ring-yellow-300/40';

  return (
    <div className="min-h-screen bg-[#001820] text-white px-4 md:px-8 py-8 md:py-12">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <GraduationCap className="text-violet-400" size={24} />
          <h1 className="font-display text-3xl">Coach Mode</h1>
        </div>
        <p className="text-white/50 mb-8">Log a lesson and get an AI development summary for the player’s record.</p>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-white/60">Player</label>
              <input className={`${input} mt-1`} style={{ color: '#fff' }} value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="e.g. Sutton K." />
            </div>
            <div>
              <label className="text-sm text-white/60">Focus area</label>
              <input className={`${input} mt-1`} style={{ color: '#fff' }} value={focusArea} onChange={(e) => setFocusArea(e.target.value)} placeholder="e.g. Kick serve" />
            </div>
          </div>

          <div>
            <label className="text-sm text-white/60">Lesson notes</label>
            <textarea className={`${input} mt-1 min-h-[120px]`} style={{ color: '#fff' }} value={content} onChange={(e) => setContent(e.target.value)} placeholder="What you worked on, how it went, what to do next…" />
          </div>

          <div>
            <label className="text-sm text-white/60">Skill check (optional)</label>
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SKILLS.map((s) => (
                <div key={s} className="flex items-center justify-between gap-2 rounded-lg bg-white/5 border border-white/10 px-3 py-2">
                  <span className="text-sm">{s}</span>
                  <select
                    className="bg-transparent text-sm text-white/80 focus:outline-none"
                    value={ratings[s] ?? ''}
                    onChange={(e) => setRatings((r) => {
                      const next = { ...r };
                      if (e.target.value === '') delete next[s];
                      else next[s] = Number(e.target.value);
                      return next;
                    })}
                  >
                    <option value="" className="bg-[#002838]">–</option>
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n} className="bg-[#002838]">{n}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button onClick={generate} disabled={generating} className="px-5 py-3 rounded-xl bg-yellow-300 text-[#001820] font-medium flex items-center justify-center gap-2 hover:bg-yellow-200 disabled:opacity-60">
              {generating ? <Loader2 size={16} className="animate-spin" /> : <><Sparkles size={16} /> Generate AI summary</>}
            </button>
            <button onClick={save} disabled={saving} className="px-5 py-3 rounded-xl bg-white/10 hover:bg-white/15 font-medium flex items-center justify-center gap-2 disabled:opacity-60">
              {saving ? <Loader2 size={16} className="animate-spin" /> : <><Save size={16} /> Save to player record</>}
            </button>
          </div>

          {summary && (
            <div className="mt-4 rounded-2xl border border-violet-400/30 bg-violet-400/[0.06] p-5">
              <div className="flex items-center gap-2 text-violet-300 text-sm font-medium mb-2">
                <Sparkles size={14} /> AI summary
              </div>
              <p className="text-white/85 text-sm whitespace-pre-wrap leading-relaxed">{summary}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

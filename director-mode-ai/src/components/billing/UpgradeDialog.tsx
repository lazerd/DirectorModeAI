'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sparkles, Check, ArrowRight, Loader2 } from 'lucide-react';

type Feature =
  | 'dj_console'
  | 'ai_recommendations'
  | 'custom_branding'
  | 'tournament_optimizer'
  | 'sms'
  | 'lesson_reminders'
  | 'csv_vault_import'
  | 'unlimited_photos'
  | 'multi_coach_org';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: Feature;
  eventId?: string;
}

const FEATURE_COPY: Record<Feature, { title: string; blurb: string; bullets: string[] }> = {
  dj_console: {
    title: 'Unlock the DJ Console',
    blurb: "Walk-on songs and spoken player intros for every match. Like Ballpark DJ — but for tennis.",
    bullets: [
      'Spoken player announcements (free, built-in voice)',
      'Pixabay royalty-free music library',
      'Operator-controlled per-player playback',
      'Works through any laptop / Bluetooth speaker',
    ],
  },
  ai_recommendations: {
    title: 'Unlock AI String Recommendations',
    blurb: 'Smart string matching based on player profile, arm health, and play style. (Free uses standard fallback.)',
    bullets: ['Tailored 2–3 picks per player from your live catalog', 'Tension recommendations', 'Arm-friendly options highlighted'],
  },
  custom_branding: {
    title: 'Add your club logo',
    blurb: 'Put your club logo on results cards, QR codes, and shareable graphics.',
    bullets: ['Upload your logo once, use everywhere', 'Looks pro on social shares', 'Drives real recognition'],
  },
  tournament_optimizer: {
    title: 'Unlock the Tournament Optimizer',
    blurb: 'Auto-balanced brackets that minimize round 1 mismatches and maximize court usage.',
    bullets: ['Skill-balanced seeding', 'Court rotation optimization', 'Fewer first-round blowouts'],
  },
  sms: {
    title: 'Unlock SMS notifications',
    blurb: 'Text players their court and match time. Hugely better attendance and on-time starts.',
    bullets: ['200 SMS / month included on Pro', 'Match-time, lesson reminder, and racket pickup texts', '$0.05 per SMS overage — no surprise bills'],
  },
  lesson_reminders: {
    title: 'Unlock automated lesson reminders',
    blurb: 'Email reminders go out automatically the day before every booking.',
    bullets: ['Cuts no-shows by ~40%', 'Customizable timing', 'Works with all your existing slots'],
  },
  csv_vault_import: {
    title: 'Unlock CSV import',
    blurb: 'Bulk-import your existing player roster from a spreadsheet.',
    bullets: ['Bring in 100s of players in seconds', 'Maps NTRP, UTR, contact info', 'No manual entry'],
  },
  unlimited_photos: {
    title: 'Unlock unlimited photos',
    blurb: 'No 5-photo cap per event. Tell the full story.',
    bullets: ['Stays on Supabase storage', 'High-res supported', 'Galleries on results cards'],
  },
  multi_coach_org: {
    title: 'Add your coaching staff',
    blurb: 'Bring multiple coaches under a single Pro plan.',
    bullets: ['Shared roster & vault', 'Unified billing', 'Per-coach booking pages'],
  },
};

export default function UpgradeDialog({ open, onOpenChange, feature, eventId }: Props) {
  const [loadingDayPass, setLoadingDayPass] = useState(false);
  const [loadingPro, setLoadingPro] = useState(false);
  const copy = FEATURE_COPY[feature];

  async function goToCheckout(body: Record<string, unknown>, setLoading: (v: boolean) => void) {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.message || data.error || 'Could not start checkout');
      window.location.href = data.url;
    } catch (err: any) {
      toast.error(err?.message || 'Could not start checkout.');
      setLoading(false);
    }
  }

  const startPro = () => goToCheckout({ priceKey: 'pro_monthly' }, setLoadingPro);
  const buyDayPass = () => {
    if (!eventId) return;
    return goToCheckout({ priceKey: 'day_pass', mode: 'one-time', eventId }, setLoadingDayPass);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#002838] border-white/10 text-white max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-yellow-300 text-sm font-medium uppercase tracking-wider">
            <Sparkles size={14} />
            Pro plan required
          </div>
          <DialogTitle className="font-display text-2xl">{copy.title}</DialogTitle>
          <DialogDescription className="text-white/60">{copy.blurb}</DialogDescription>
        </DialogHeader>

        <ul className="space-y-2 my-4">
          {copy.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-2 text-sm text-white/80">
              <Check size={16} className="mt-0.5 text-emerald-400 flex-shrink-0" />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        <div className="grid gap-2">
          <button
            onClick={startPro}
            disabled={loadingPro}
            className="w-full py-3 rounded-xl bg-yellow-300 text-[#001820] font-medium text-sm flex items-center justify-center gap-2 hover:bg-yellow-200 disabled:opacity-60"
          >
            {loadingPro ? <Loader2 size={16} className="animate-spin" /> : <>Go Pro — $29/mo <ArrowRight size={14} /></>}
          </button>
          {eventId && feature !== 'multi_coach_org' && feature !== 'csv_vault_import' && (
            <button
              onClick={buyDayPass}
              disabled={loadingDayPass}
              className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loadingDayPass ? 'Redirecting…' : 'Or unlock just this event for $9'}
            </button>
          )}
          <Link
            href="/pricing"
            className="w-full text-center text-xs text-white/40 hover:text-white/70 pt-1"
          >
            Compare plans
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { CheckCircle2, Circle, ArrowRight, Loader2, Sparkles, LayoutGrid, Users, Database, Trophy } from 'lucide-react';

type State = { clubName: string | null; hasEvent: boolean; hasCourts: boolean; hasMembers: boolean; hasVault: boolean };

export default function WelcomePage() {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = '/login?redirect=/welcome'; return; }
      setName((user.user_metadata?.full_name || user.email?.split('@')[0] || '').split(' ')[0]);
      try {
        const res = await fetch('/api/me/onboarding');
        const j = await res.json();
        if (j.signedIn) setState(j);
      } finally { setLoading(false); }
    })();
  }, []);

  const steps = state ? [
    { done: true, title: 'Create your account', desc: "You're in — welcome to ClubMode.", href: null, icon: Sparkles, color: '#D3FB52' },
    { done: state.hasEvent, title: 'Run your first event', desc: 'A round robin, mixer, league, or tournament — set up in a couple of minutes.', href: '/mixer/events/new', icon: Trophy, color: '#fb923c' },
    { done: state.hasCourts, title: 'Set up your court sheet', desc: 'Add your courts for the live court grid, reservations, and member booking.', href: '/courtsheet/staff', icon: LayoutGrid, color: '#22d3ee' },
    { done: state.hasVault, title: 'Add your players', desc: 'Build your PlayerVault roster — import a spreadsheet or add players.', href: '/courtconnect/vault', icon: Database, color: '#2dd4bf' },
    { done: state.hasMembers, title: 'Invite your members', desc: 'Share your join link so members can book courts, sign up for lessons, and track progress.', href: '/club/members', icon: Users, color: '#38bdf8' },
  ] : [];

  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const allDone = state && doneCount === steps.length;

  if (loading) {
    return <div className="min-h-screen bg-[#001820] flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-yellow-300" /></div>;
  }

  return (
    <div className="min-h-screen bg-[#001820] text-white px-4 md:px-8 py-10 md:py-16">
      <div className="max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-yellow-300/90 bg-yellow-300/10 border border-yellow-300/20 rounded-full px-3 py-1 mb-4">
          <Sparkles size={13} /> Getting started
        </div>
        <h1 className="font-display text-4xl mb-2">Welcome{name ? `, ${name}` : ''} 👋</h1>
        <p className="text-white/60 mb-6">
          {allDone ? "You're all set up — your club is ready to run." : "Let's get your club running. Knock these out whenever you're ready."}
        </p>

        <div className="mb-8">
          <div className="flex items-center justify-between text-sm text-white/50 mb-2">
            <span>{doneCount} of {steps.length} done</span><span>{pct}%</span>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full bg-yellow-300 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="space-y-3">
          {steps.map((s, i) => {
            const Icon = s.icon;
            const body = (
              <div className={`flex items-center gap-4 rounded-2xl border p-4 transition-colors ${s.done ? 'border-emerald-400/20 bg-emerald-400/[0.04]' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                {s.done ? <CheckCircle2 className="text-emerald-400 shrink-0" size={22} /> : <Circle className="text-white/30 shrink-0" size={22} />}
                <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}1a` }}>
                  <Icon size={18} style={{ color: s.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`font-medium ${s.done ? 'text-white/60 line-through' : 'text-white'}`}>{s.title}</div>
                  <div className="text-sm text-white/50">{s.desc}</div>
                </div>
                {!s.done && s.href && <ArrowRight size={18} className="text-white/40 shrink-0" />}
              </div>
            );
            return s.href && !s.done ? <Link key={i} href={s.href}>{body}</Link> : <div key={i}>{body}</div>;
          })}
        </div>

        <div className="mt-8 flex items-center gap-4">
          <Link href="/mixer/home" className="px-5 py-3 rounded-xl bg-yellow-300 text-[#001820] font-medium flex items-center gap-2 hover:bg-yellow-200">
            Go to my dashboard <ArrowRight size={16} />
          </Link>
          <Link href="/pricing" className="text-sm text-white/50 hover:text-white/80">See Pro</Link>
        </div>
      </div>
    </div>
  );
}

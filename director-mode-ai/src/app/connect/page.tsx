'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ClubSidebar from '@/components/shared/ClubSidebar';
import { Briefcase, UserSearch, MapPin, ArrowRight, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type Pool = {
  total_candidates: number;
  open_openings: number;
  by_dept: Record<string, { count: number; median_comp: number | null }>;
  scoped: boolean;
  zip: string | null;
  radius: number | null;
};

const DEPT_LABEL: Record<string, string> = {
  'Tennis/Racquets': 'Tennis / Racquets',
  Golf: 'Golf',
  GM: 'GM / COO',
};
const usd = (n: number | null) => (n != null ? `$${Math.round(n).toLocaleString()}` : '—');

export default function ConnectLanding() {
  const [pool, setPool] = useState<Pool | null>(null);
  const [zip, setZip] = useState('');
  const [radius, setRadius] = useState('50');

  async function load(scoped = false) {
    const params = new URLSearchParams();
    if (scoped && zip) {
      params.set('zip', zip.replace(/\D/g, '').slice(0, 5));
      params.set('radius', radius);
    }
    const res = await fetch(`/api/connect/pool?${params.toString()}`);
    if (res.ok) setPool(await res.json());
  }

  useEffect(() => { load(false); }, []);

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <ClubSidebar />
      <div className="text-center mb-10">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">ClubMode Connect</h1>
        <p className="mt-3 text-lg text-slate-600 max-w-2xl mx-auto">
          The quiet bridge between clubs hiring and directors open to the right move.
          Built on the largest comp dataset in racquet &amp; golf leadership.
        </p>
      </div>

      {/* Live market snapshot */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-teal-600" />
            {pool?.scoped
              ? `Open to work within ${pool.radius} mi of ${pool.zip}`
              : 'The talent pool right now'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Stat label="Directors open to work" value={pool ? String(pool.total_candidates) : '—'} />
            <Stat label="Open positions" value={pool ? String(pool.open_openings) : '—'} />
            {pool && Object.entries(pool.by_dept).slice(0, 2).map(([dept, d]) => (
              <Stat key={dept} label={`${DEPT_LABEL[dept] || dept} median`} value={usd(d.median_comp)} />
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-slate-500 flex items-center gap-1"><MapPin className="h-3 w-3" /> Your ZIP</label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10591" className="w-28" style={{ color: '#0f172a' }} />
            </div>
            <div>
              <label className="text-xs text-slate-500">Radius (mi)</label>
              <Input value={radius} onChange={(e) => setRadius(e.target.value)} className="w-24" style={{ color: '#0f172a' }} />
            </div>
            <Button variant="outline" onClick={() => load(true)}>See my area</Button>
            {pool?.scoped && <Button variant="ghost" onClick={() => { setZip(''); load(false); }}>Reset</Button>}
          </div>
        </CardContent>
      </Card>

      {/* Two doors */}
      <div className="grid sm:grid-cols-2 gap-6">
        <Door
          href="/connect/candidate"
          icon={<UserSearch className="h-6 w-6 text-teal-600" />}
          title="I'm a director — get found"
          body="Set your current comp and how far you'd move. Stay anonymous until a club with a better offer wants to talk. You're only revealed on a real match."
          cta="Create my profile"
        />
        <Door
          href="/connect/clubs"
          icon={<Briefcase className="h-6 w-6 text-teal-600" />}
          title="I'm a club — find talent"
          body="Post your opening with the comp you can pay. We surface qualified directors nearby who'd jump for it — with contact info, because they opted in."
          cta="Post an opening"
        />
      </div>

      <p className="mt-8 text-center text-sm text-slate-500">
        Looking for the raw comp data?{' '}
        <Link href="/benchmarks" className="text-teal-700 underline">Browse the benchmarks →</Link>
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function Door({ href, icon, title, body, cta }: { href: string; icon: React.ReactNode; title: string; body: string; cta: string }) {
  return (
    <Link href={href}>
      <Card className="h-full transition hover:shadow-md hover:border-teal-300">
        <CardHeader>
          <div className="mb-2">{icon}</div>
          <CardTitle className="text-xl text-slate-900">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">{body}</p>
          <span className="inline-flex items-center gap-1 text-teal-700 font-medium text-sm">
            {cta} <ArrowRight className="h-4 w-4" />
          </span>
        </CardContent>
      </Card>
    </Link>
  );
}

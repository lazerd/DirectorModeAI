'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, TrendingUp, Share2, ArrowRight, MapPin, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';

const DEPTS = [
  { key: 'Tennis/Racquets', label: 'Director of Tennis / Racquets' },
  { key: 'Golf', label: 'Director of Golf' },
  { key: 'GM', label: 'General Manager / COO' },
];
const inputStyle = { color: '#0f172a' };
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

type Result = {
  dept: string; currentComp: number; n: number; percentile: number;
  median: number; avg: number; p25: number; p75: number; p90: number; max: number;
  gapToMedian: number; gapToP75: number; medianPct: number | null; expectedByRevenue: number | null; sizeBandN: number;
  local: { n: number; median: number; radiusMiles: number } | null;
  comparables: { club: string; title: string; total: number; year: string; pct: number | null; distanceMiles: number | null }[];
  verdict: 'underpaid' | 'market' | 'above';
};

export default function ScorePage() {
  const [dept, setDept] = useState('Tennis/Racquets');
  const [comp, setComp] = useState('');
  const [zip, setZip] = useState('');
  const [revenue, setRevenue] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(false);

  // Reproduce a shared result from the URL (?dept=&comp=&zip=&rev=).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('comp')) {
      const d = q.get('dept') || 'Tennis/Racquets';
      setDept(d); setComp(q.get('comp')!); setZip(q.get('zip') || ''); setRevenue(q.get('rev') || '');
      run(d, q.get('comp')!, q.get('zip') || '', q.get('rev') || '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(d = dept, c = comp, z = zip, r = revenue) {
    if (!c) return;
    setBusy(true); setResult(null);
    const res = await fetch('/api/benchmarks/score', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dept: d, currentComp: Number(c), zip: z || undefined, revenue: r ? Number(r) : undefined }),
    });
    if (res.ok) {
      setResult(await res.json());
      const q = new URLSearchParams({ dept: d, comp: c, ...(z ? { zip: z } : {}), ...(r ? { rev: r } : {}) });
      window.history.replaceState(null, '', `?${q.toString()}`);
    }
    setBusy(false);
  }

  function share() {
    navigator.clipboard?.writeText(window.location.href);
    setShared(true); setTimeout(() => setShared(false), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/benchmarks" className="text-sm text-teal-700 underline">← Compensation Benchmarks</Link>
      <div className="mt-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Sparkles className="h-7 w-7 text-teal-600" /> Know Your Number
        </h1>
        <p className="mt-1 text-slate-600">See where your pay lands against {DATA_N} club leaders nationwide — and what the market says you could be earning.</p>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Your role</Label>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Your total comp ($)</Label>
              <Input value={comp} onChange={(e) => setComp(e.target.value)} placeholder="150000" style={inputStyle} />
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Your ZIP (for local comps)</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10591" style={inputStyle} />
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Club annual revenue ($, optional)</Label>
              <Input value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="8000000" style={inputStyle} />
            </div>
          </div>
          <Button className="mt-4" onClick={() => run()} disabled={busy || !comp}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Crunching…</> : 'Get my number'}
          </Button>
        </CardContent>
      </Card>

      {result && <ResultCard r={result} onShare={share} shared={shared} dept={dept} comp={comp} zip={zip} />}
    </div>
  );
}

const DATA_N = '3,900+';

function ResultCard({ r, onShare, shared, dept, comp, zip }: { r: Result; onShare: () => void; shared: boolean; dept: string; comp: string; zip: string }) {
  const tone =
    r.verdict === 'underpaid' ? { bg: 'from-amber-50 to-orange-50', ring: 'border-amber-200', text: 'text-amber-700', head: 'You may be underpaid' }
    : r.verdict === 'above' ? { bg: 'from-emerald-50 to-teal-50', ring: 'border-emerald-200', text: 'text-emerald-700', head: 'You\'re ahead of the market' }
    : { bg: 'from-slate-50 to-slate-100', ring: 'border-slate-200', text: 'text-slate-700', head: 'You\'re right at market' };
  const upside = Math.max(r.gapToMedian, 0);
  const connectHref = `/connect/candidate`;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <div className={`rounded-2xl border ${tone.ring} bg-gradient-to-br ${tone.bg} p-6`}>
        <div className="text-sm font-medium text-slate-500">{tone.head}</div>
        <div className="mt-1 text-4xl font-bold text-slate-900">{ordinal(r.percentile)} percentile</div>
        <p className="mt-1 text-slate-600">
          Your {usd(r.currentComp)} ranks above {r.percentile}% of {r.n.toLocaleString()} {deptLabel(r.dept)} nationwide.
        </p>

        {/* Percentile bar */}
        <div className="mt-5">
          <div className="relative h-3 rounded-full bg-white/70 border">
            <div className="absolute -top-0.5 h-4 w-1.5 rounded bg-slate-900" style={{ left: `calc(${Math.min(98, Math.max(1, r.percentile))}% - 3px)` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500">
            <span>25th: {usd(r.p25)}</span><span>median: {usd(r.median)}</span><span>75th: {usd(r.p75)}</span>
          </div>
        </div>

        {upside > 0 && (
          <div className={`mt-4 text-lg font-semibold ${tone.text}`}>
            Market median is {usd(r.median)} — about {usd(upside)} above what you make.
          </div>
        )}
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Mini label="Market median" value={usd(r.median)} />
        <Mini label="Top 25% earn" value={`${usd(r.p75)}+`} />
        <Mini label="Top 10% earn" value={`${usd(r.p90)}+`} />
        <Mini label={r.local ? `Local median (${r.local.radiusMiles}mi)` : 'Sample size'} value={r.local ? usd(r.local.median) : `${r.n.toLocaleString()} pros`} />
      </div>

      {r.expectedByRevenue != null && (
        <Card>
          <CardContent className="py-4 text-sm text-slate-700">
            <TrendingUp className="h-4 w-4 inline text-teal-600 mr-1" />
            At clubs of a <strong>similar size</strong> to yours ({r.sizeBandN} clubs near your revenue), {deptLabel(r.dept)} earn a median of <strong>{usd(r.expectedByRevenue)}</strong>
            {r.expectedByRevenue > r.currentComp ? <> — about {usd(r.expectedByRevenue - r.currentComp)} above your pay.</> : '.'}
            {r.medianPct != null && <span className="text-slate-400"> ({deptLabel(r.dept)} typically run ~{((r.medianPct) * 100).toFixed(1)}% of club revenue.)</span>}
          </CardContent>
        </Card>
      )}

      {/* CTA — the funnel into Connect */}
      <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
        <div className="font-semibold text-slate-900">Want clubs that pay more to find you?</div>
        <p className="text-sm text-slate-600 mt-1">
          Stay anonymous on ClubMode Connect. We'll quietly alert you when a club within your range posts an opening that beats {usd(r.currentComp)} — and only reveal you on a match.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={connectHref}><Button className="gap-1">Get found <ArrowRight className="h-4 w-4" /></Button></Link>
          <Button variant="outline" onClick={onShare} className="gap-1"><Share2 className="h-4 w-4" /> {shared ? 'Link copied!' : 'Share my result'}</Button>
        </div>
      </div>

      {/* Comparables */}
      <Card>
        <CardHeader><CardTitle className="text-base">{r.comparables.some((c) => c.distanceMiles != null) ? 'Comparable clubs near you' : 'Comparable pay at peer clubs'}</CardTitle></CardHeader>
        <CardContent>
          <div className="divide-y">
            {r.comparables.map((c, i) => (
              <div key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{c.club}</div>
                  <div className="text-slate-500 truncate">{c.title}{c.distanceMiles != null ? ` · ${c.distanceMiles} mi` : ''} · {c.year}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold tabular-nums text-slate-900">{usd(c.total)}</div>
                  {c.pct != null && <div className="text-[11px] text-slate-400">{(c.pct * 100).toFixed(1)}% of rev</div>}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 flex items-center justify-between gap-3">
        <span>This is base 990 comp. Add your <strong>full package</strong> — bonus, housing, dues — for your true number.</span>
        <Link href="/benchmarks/profile" className="shrink-0 text-teal-700 font-medium underline">Add my package →</Link>
      </div>

      <p className="text-xs text-slate-400">
        Based on IRS Form 990 filings (officers + highest-paid staff, most recent year per club). Figures are base reportable comp and lag 1–2 years; your full package (bonus, housing, dues) may differ.
      </p>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-lg font-bold text-slate-900">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  );
}

function deptLabel(d: string) {
  return d === 'Tennis/Racquets' ? 'racquets directors' : d === 'Golf' ? 'golf directors' : 'GMs / COOs';
}
function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

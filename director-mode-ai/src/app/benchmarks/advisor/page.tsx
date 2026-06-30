'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, Gauge, ArrowRight, Building2 } from 'lucide-react';
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
const REGIONS = ['Northeast', 'South', 'Midwest', 'West'];
const inputStyle = { color: '#0f172a' };
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

type Result = {
  dept: string; revenue: number; low: number; mid: number; high: number;
  method: 'model' | 'cohort'; n: number; pctOfRevenue: number; deptMedianPct: number | null;
  regionAdjusted: boolean; cohortMedian: number | null; cohortN: number;
  currentVerdict: 'below' | 'in' | 'above' | null;
  comparables: { club: string; title: string; total: number; revenue: number; pct: number | null; state: string; distanceMiles: number | null }[];
};

export default function AdvisorPage() {
  const [dept, setDept] = useState('Tennis/Racquets');
  const [revenue, setRevenue] = useState('');
  const [region, setRegion] = useState('');
  const [zip, setZip] = useState('');
  const [current, setCurrent] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!revenue) return;
    setBusy(true); setResult(null);
    const res = await fetch('/api/benchmarks/advisor', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dept, revenue: Number(revenue), region: region || undefined, zip: zip || undefined, currentComp: current ? Number(current) : undefined }),
    });
    if (res.ok) setResult(await res.json());
    setBusy(false);
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/benchmarks" className="text-sm text-teal-700 underline">← Compensation Benchmarks</Link>
      <div className="mt-2 mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
          <Building2 className="h-7 w-7 text-teal-600" /> Comp Advisor for Clubs
        </h1>
        <p className="mt-1 text-slate-600">Hiring or retaining a leader? Get a defensible pay band for your club's size and region — works even if your club isn't in the public data.</p>
      </div>

      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Role to set comp for</Label>
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Club annual revenue ($)</Label>
              <Input value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="8000000" style={inputStyle} />
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger><SelectValue placeholder="(optional)" /></SelectTrigger>
                <SelectContent>{REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Club ZIP (for local comps)</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10591" style={inputStyle} />
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">What you pay now ($, optional)</Label>
              <Input value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="160000" style={inputStyle} />
            </div>
          </div>
          <Button className="mt-4" onClick={run} disabled={busy || !revenue}>
            {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Calculating…</> : 'Recommend a comp band'}
          </Button>
        </CardContent>
      </Card>

      {result && <ResultCard r={result} dept={dept} zip={zip} />}
    </div>
  );
}

function ResultCard({ r, dept, zip }: { r: Result; dept: string; zip: string }) {
  const connectHref = `/connect/clubs?dept=${encodeURIComponent(dept)}&comp_max=${r.high}${zip ? `&zip=${zip}` : ''}`;
  const verdict =
    r.currentVerdict === 'below' ? { c: 'text-amber-700', t: 'Below market — you may struggle to attract or keep talent.' }
    : r.currentVerdict === 'above' ? { c: 'text-emerald-700', t: 'Above the recommended band — generous for your size.' }
    : r.currentVerdict === 'in' ? { c: 'text-slate-700', t: 'In line with the market for your size and region.' }
    : null;

  return (
    <div className="space-y-5">
      {/* Recommended band */}
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-6">
        <div className="text-sm font-medium text-slate-500">Recommended total comp band</div>
        <div className="mt-1 text-4xl font-bold text-slate-900">{usd(r.low)} – {usd(r.high)}</div>
        <div className="mt-1 text-slate-600">Target around <strong>{usd(r.mid)}</strong> · ~{(r.pctOfRevenue * 100).toFixed(1)}% of your revenue</div>

        {/* band bar with current marker */}
        <div className="mt-5">
          <div className="relative h-3 rounded-full bg-white/70 border">
            <div className="absolute inset-y-0 rounded-full bg-teal-300/70" style={{ left: '12%', right: '12%' }} />
            <div className="absolute -top-0.5 h-4 w-1 rounded bg-slate-900" style={{ left: '50%' }} title="target" />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-500"><span>{usd(r.low)}</span><span>target {usd(r.mid)}</span><span>{usd(r.high)}</span></div>
        </div>

        {verdict && <div className={`mt-4 font-semibold ${verdict.c}`}>{verdict.t}</div>}
      </div>

      {/* % of revenue board check */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Mini label="% of your revenue" value={`${(r.pctOfRevenue * 100).toFixed(1)}%`} />
        {r.deptMedianPct != null && <Mini label="Typical for this role" value={`${(r.deptMedianPct * 100).toFixed(1)}% of rev`} />}
        {r.cohortMedian != null && <Mini label={`Similar-size clubs (${r.cohortN})`} value={`${usd(r.cohortMedian)} median`} />}
      </div>

      {/* CTA — post the opening into Connect */}
      <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
        <div className="font-semibold text-slate-900">Ready to fill it?</div>
        <p className="text-sm text-slate-600 mt-1">
          Post this opening on ClubMode Connect and we'll surface qualified directors nearby who'd move for it — with their contact info, because they opted in.
        </p>
        <Link href={connectHref}><Button className="mt-3 gap-1">Post this opening <ArrowRight className="h-4 w-4" /></Button></Link>
      </div>

      {/* Comparables */}
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Gauge className="h-4 w-4 text-teal-600" /> Comparable clubs your size</CardTitle></CardHeader>
        <CardContent>
          <div className="divide-y">
            {r.comparables.map((c, i) => (
              <div key={i} className="py-2 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-slate-900 truncate">{c.club} <span className="text-slate-400 font-normal">· {c.state}</span></div>
                  <div className="text-slate-500 truncate">{c.title}{c.distanceMiles != null ? ` · ${c.distanceMiles} mi` : ''} · {usd(c.revenue)} revenue</div>
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

      <p className="text-xs text-slate-400">
        {r.method === 'model'
          ? `Modeled from ${r.n} comparable ${dept === 'GM' ? 'GM/COO' : dept.toLowerCase()} filings (comp vs club revenue${r.regionAdjusted ? ', region-adjusted' : ''}).`
          : `Based on ${r.n} similarly-sized clubs.`} Source: IRS Form 990 base reportable comp; full packages (bonus, housing, dues) run higher.
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

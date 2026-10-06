'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Lock, Unlock, Share2, ShieldCheck, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import {
  ROLES, CLUB_TYPES, SIZE_BANDS, YEARS_BANDS, EMPLOYMENT,
  type PulseRow, type PulseResults, type MetricResult, type Stat,
} from '@/lib/benchmarks/pulse';

// Director Pulse — share your pay & program pricing anonymously, see everyone
// else's. The server only ever returns blinded stats, and only once you've
// contributed (see /api/benchmarks/pulse).

const inputStyle = { color: '#0f172a' };
const MIN = 5;

type Payload = {
  signedIn: boolean;
  contributors: number;
  ninetySeed: { n: number; median: number; p25: number; p75: number } | null;
  mine: PulseRow | null;
  results: PulseResults | null;
};

const CLINIC_MODELS = [
  { v: 'percent', l: '% of clinic revenue' },
  { v: 'hourly', l: 'Hourly rate' },
  { v: 'included', l: 'Included in salary' },
];
const STRINGING_OPTS = [
  { v: 'pro', l: 'I keep it' },
  { v: 'club', l: 'Club keeps it' },
  { v: 'split', l: 'Split' },
  { v: 'none', l: 'No stringing' },
];
const YESNO = [{ v: 'yes', l: 'Yes' }, { v: 'no', l: 'No' }];
const opts = (list: readonly string[]) => list.map((v) => ({ v, l: v }));

function fmt(unit: string, n: number) {
  if (unit === 'usd' || unit === 'rate') return `$${Math.round(n).toLocaleString()}`;
  if (unit === 'pct') return `${n}%`;
  return `${n} hrs`;
}

export default function PulsePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);

  async function load() {
    const res = await fetch('/api/benchmarks/pulse', { cache: 'no-store' });
    const d: Payload = await res.json();
    setData(d);
    if (d.mine) {
      const m = d.mine as Record<string, unknown>;
      const nf: Record<string, string> = {};
      for (const [k, v] of Object.entries(m)) {
        if (v == null) continue;
        nf[k] = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
      }
      setF(nf);
    }
  }
  useEffect(() => { load(); }, []);

  const set = (k: string) => (v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    setSaving(true); setErr('');
    const res = await fetch('/api/benchmarks/pulse', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
    });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error || 'Save failed.');
    else { setEditing(false); await load(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    setSaving(false);
  }

  function invite() {
    navigator.clipboard?.writeText(`${window.location.origin}/benchmarks/pulse`);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  if (!data) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;

  const unlocked = !!data.results && !editing;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/benchmarks" className="text-sm text-teal-700 underline">← Compensation Benchmarks</Link>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-2 mb-1">Director Pulse</h1>
      <p className="text-slate-600 mb-4">
        What do other pros really make, charge for a private, and keep from the club? Share your numbers anonymously and you&apos;ll see everyone else&apos;s.
      </p>

      <div className="mb-6 flex flex-wrap gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-slate-700">
          <Users className="h-4 w-4 text-teal-600" /> {data.contributors} pro{data.contributors === 1 ? '' : 's'} have shared
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-white px-3 py-1 text-slate-700">
          <ShieldCheck className="h-4 w-4 text-teal-600" /> No names, no clubs. Groups under {MIN} are never shown.
        </span>
      </div>

      {data.ninetySeed && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <strong>Public baseline:</strong> racquets directors on IRS 990 filings earn a median of{' '}
          <strong>${data.ninetySeed.median.toLocaleString()}</strong> (middle half ${data.ninetySeed.p25.toLocaleString()}–${data.ninetySeed.p75.toLocaleString()}, n={data.ninetySeed.n.toLocaleString()}).
          The 990 can&apos;t show lesson rates, splits or clinic pay. That&apos;s what Pulse is for.
        </div>
      )}

      {unlocked ? (
        <Results r={data.results!} onEdit={() => setEditing(true)} onInvite={invite} copied={copied} />
      ) : !data.signedIn ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Lock className="h-6 w-6 mx-auto text-slate-400" />
            <p className="mt-2 text-slate-700">Sign in to add your numbers and unlock the results. It takes about two minutes.</p>
            <Link href="/login?redirect=/benchmarks/pulse"><Button className="mt-4">Sign in to contribute</Button></Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lock className="h-4 w-4 text-teal-600" /> {data.mine ? 'Update your numbers' : 'Add yours to unlock'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Section title="About your job">
              <Pick label="Role *" value={f.role} onChange={set('role')} options={opts(ROLES)} />
              <Pick label="Club type *" value={f.club_type} onChange={set('club_type')} options={opts(CLUB_TYPES)} />
              <Pick label="Club size" value={f.size_band} onChange={set('size_band')} options={opts(SIZE_BANDS)} />
              <Num label="State (2 letters)" k="state" f={f} set={set} placeholder="CA" />
              <Pick label="Years in the business" value={f.years_band} onChange={set('years_band')} options={opts(YEARS_BANDS)} />
              <Pick label="Employment" value={f.employment} onChange={set('employment')} options={opts(EMPLOYMENT)} />
            </Section>

            <Section title="Your pay (annual)">
              <Num label="Total income, all-in *" k="total_income" f={f} set={set} placeholder="185000" hint="Salary + lessons + clinics + stringing" />
              <Num label="Base salary" k="base_salary" f={f} set={set} placeholder="90000" />
              <Num label="Bonus" k="bonus" f={f} set={set} placeholder="10000" />
            </Section>

            <Section title="Pricing & splits">
              <Num label="Private lesson, 60 min ($) *" k="private_rate" f={f} set={set} placeholder="140" hint="What the member pays" />
              <Num label="% of private fee you keep" k="private_share_pct" f={f} set={set} placeholder="70" />
              <Num label="Adult clinic, per player/hour ($)" k="clinic_price_hr" f={f} set={set} placeholder="40" />
              <Pick label="How you're paid for clinics" value={f.clinic_pay_model} onChange={set('clinic_pay_model')} options={CLINIC_MODELS} />
              {f.clinic_pay_model === 'percent' && <Num label="Your % of clinic revenue" k="clinic_pay_value" f={f} set={set} placeholder="50" />}
              {f.clinic_pay_model === 'hourly' && <Num label="Your clinic $/hour" k="clinic_pay_value" f={f} set={set} placeholder="60" />}
              <Num label="Junior program, per player/hour ($)" k="junior_price_hr" f={f} set={set} placeholder="35" />
              <Pick label="Stringing revenue" value={f.stringing} onChange={set('stringing')} options={STRINGING_OPTS} />
              <Num label="Teaching hours / week" k="teaching_hours_wk" f={f} set={set} placeholder="25" />
            </Section>

            <Section title="Benefits">
              <Pick label="Health insurance provided" value={f.health_insurance} onChange={set('health_insurance')} options={YESNO} />
              <Pick label="Retirement match" value={f.retirement_match} onChange={set('retirement_match')} options={YESNO} />
            </Section>

            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button onClick={submit} disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving…</> : data.mine ? 'Save & view results' : 'Share & unlock'}
              </Button>
              {data.mine && <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
              {err && <span className="text-sm text-red-600">{err}</span>}
            </div>
            <p className="text-xs text-slate-500">
              We never show your row to anyone. Results are medians and ranges, rounded, and only for groups of {MIN} or more. Your sign-in is how we stop duplicate entries. It is never attached to what others see.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Results({ r, onEdit, onInvite, copied }: { r: PulseResults; onEdit: () => void; onInvite: () => void; copied: boolean }) {
  const shown = r.metrics.filter((m) => m.stat);
  const locked = r.metrics.filter((m) => !m.stat && m.have > 0);
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900 flex items-center gap-2"><Unlock className="h-4 w-4 text-teal-600" /> You&apos;re in. Thanks for sharing.</div>
          <div className="text-sm text-slate-600 mt-0.5">Every pro you invite unlocks more of this page for everyone.</div>
        </div>
        <div className="flex gap-2">
          <Button onClick={onInvite} className="gap-1"><Share2 className="h-4 w-4" /> {copied ? 'Link copied!' : 'Invite a pro'}</Button>
          <Button variant="outline" onClick={onEdit}>Edit mine</Button>
        </div>
      </div>

      {shown.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">The numbers</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {shown.map((m, i) => <MetricRow key={i} m={m} />)}
          </CardContent>
        </Card>
      )}

      {locked.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><Lock className="h-4 w-4 text-slate-400" /> Still locked</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {locked.map((m, i) => (
              <div key={i}>
                <div className="flex justify-between text-sm text-slate-700">
                  <span>{m.label}</span><span className="text-slate-500">{m.have} of {MIN}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-slate-100">
                  <div className="h-2 rounded-full bg-teal-500" style={{ width: `${Math.min(100, (m.have / MIN) * 100)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {r.mixes.some((x) => x.shares) && (
        <Card>
          <CardHeader><CardTitle className="text-base">How programs are set up</CardTitle></CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-4">
            {r.mixes.filter((x) => x.shares).map((x, i) => (
              <div key={i}>
                <div className="text-sm font-medium text-slate-900 mb-1">{x.label} <span className="text-slate-400 font-normal">· n={x.n}</span></div>
                {x.shares!.map((s) => (
                  <div key={s.value} className="flex items-center gap-2 text-sm">
                    <div className="w-28 text-slate-600 truncate">{label(s.value)}</div>
                    <div className="flex-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal-500" style={{ width: `${s.pct}%` }} /></div>
                    <div className="w-10 text-right tabular-nums text-slate-700">{s.pct}%</div>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {r.breakdowns.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Breakdowns</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {r.breakdowns.map((b, i) => (
              <div key={i}>
                <div className="text-sm font-medium text-slate-900 mb-1">
                  {b.metric === 'total_income' ? 'Total income' : 'Private rate'} by {b.by === 'club_type' ? 'club type' : b.by}
                </div>
                {b.cells.map((c) => (
                  <div key={c.group} className="flex justify-between text-sm py-0.5">
                    <span className="text-slate-600">{c.group}</span>
                    <span className="tabular-nums text-slate-900">{fmt(b.unit, c.stat!.median)} <span className="text-slate-400">· n={c.stat!.n}</span></span>
                  </div>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-slate-400">
        Self-reported by signed-in pros, {r.contributors} so far. Medians and middle-half ranges, rounded. Groups under {MIN} are hidden.
      </p>
    </div>
  );
}

function MetricRow({ m }: { m: MetricResult }) {
  const s = m.stat as Stat;
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm text-slate-700">{m.label} <span className="text-slate-400">· n={s.n}</span></div>
        <div className="text-lg font-bold tabular-nums text-slate-900">{fmt(m.unit, s.median)}</div>
      </div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>Middle half: {fmt(m.unit, s.p25)} – {fmt(m.unit, s.p75)}</span>
        {m.mine != null && m.myPercentile != null && (
          <span className="text-teal-700">You: {fmt(m.unit, m.mine)} · higher than ~{m.myPercentile}%</span>
        )}
      </div>
    </div>
  );
}

function label(v: string) {
  return ({ percent: '% of revenue', hourly: 'Hourly', included: 'In salary', pro: 'Pro keeps', club: 'Club keeps', split: 'Split', none: 'None' } as Record<string, string>)[v] || v;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-semibold text-slate-900 mb-2">{title}</div>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Pick({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      <Select value={value || ''} onValueChange={onChange}>
        <SelectTrigger style={inputStyle}><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>{options.map((o) => <SelectItem key={o.v} value={o.v}>{o.l}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

function Num({ label, k, f, set, placeholder, hint }: { label: string; k: string; f: Record<string, string>; set: (k: string) => (v: string) => void; placeholder?: string; hint?: string }) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      <Input value={f[k] || ''} onChange={(e) => set(k)(e.target.value)} placeholder={placeholder} style={inputStyle} inputMode={k === 'state' ? 'text' : 'decimal'} />
      {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

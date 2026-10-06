'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Lock, Unlock, Share2, ShieldCheck, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  ROLES, CLUB_TYPES, SIZE_BANDS, YEARS_BANDS, EMPLOYMENT,
  type PulseRow, type PulseResults, type MetricResult, type Stat,
} from '@/lib/benchmarks/pulse';

// Director Pulse — share your pay & program pricing anonymously, see everyone
// else's. The server only ever returns blinded stats, and only once you've
// contributed (see /api/benchmarks/pulse).

// Inline colors on purpose: globals.css styles form controls with unlayered
// CSS that beats Tailwind classes, which left these dark-on-dark.
const inputStyle = { color: '#0f172a', backgroundColor: '#fff' };

type Payload = {
  signedIn: boolean;
  contributors: number;
  ninetySeed: { n: number; median: number; p25: number; p75: number } | null;
  mine: PulseRow | null;
  myEmail: string | null;
  myLink: string | null;
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
    // ?t= is the private link from the results email; the API turns it into a cookie.
    const t = new URLSearchParams(window.location.search).get('t');
    const res = await fetch(`/api/benchmarks/pulse${t ? `?t=${encodeURIComponent(t)}` : ''}`, { cache: 'no-store' });
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
          <ShieldCheck className="h-4 w-4 text-teal-600" /> Anonymous: no names, no clubs.
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
        <Results r={data.results!} myLink={data.myLink} signedIn={data.signedIn} onEdit={() => setEditing(true)} onInvite={invite} copied={copied} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2" style={{ color: '#0f172a' }}>
              <Lock className="h-4 w-4 text-teal-600" /> {data.mine ? 'Update your numbers' : 'Add yours to unlock'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {!data.signedIn && !data.mine && (
              <Section title="Where to send your results">
                <Num label="Email *" k="email" f={f} set={set} placeholder="you@yourclub.com" hint="We email you a private link to your results. Never shown to anyone." />
              </Section>
            )}

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
              <Num label="4-player adult clinic: price per player/hour ($)" k="clinic_price_hr" f={f} set={set} placeholder="40" />
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
              We never show your row to anyone. Results are medians and ranges, rounded. Come back any time with the private link we email you; the numbers update as more pros share. Your email is never attached to anything others see.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Results({ r, myLink, signedIn, onEdit, onInvite, copied }: { r: PulseResults; myLink: string | null; signedIn: boolean; onEdit: () => void; onInvite: () => void; copied: boolean }) {
  const shown = r.metrics.filter((m) => m.stat);
  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-teal-200 bg-gradient-to-br from-teal-50 to-emerald-50 p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900 flex items-center gap-2"><Unlock className="h-4 w-4 text-teal-600" /> You&apos;re in. Thanks for sharing.</div>
          <div className="text-sm text-slate-600 mt-0.5">Come back any time. These numbers update as more pros share, and every pro you invite makes them sharper.</div>
        </div>
        <div className="flex gap-2">
          <Button onClick={onInvite} className="gap-1"><Share2 className="h-4 w-4" /> {copied ? 'Link copied!' : 'Invite a pro'}</Button>
          <Button variant="outline" onClick={onEdit}>Edit mine</Button>
        </div>
      </div>

      {myLink && !signedIn && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          <strong>Your private results link</strong> (we emailed it to you too):{' '}
          <a href={myLink} className="text-teal-700 underline break-all">{myLink}</a>
        </div>
      )}

      {shown.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base" style={{ color: '#0f172a' }}>The numbers</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {shown.map((m, i) => <MetricRow key={i} m={m} />)}
          </CardContent>
        </Card>
      )}


      {r.mixes.some((x) => x.shares) && (
        <Card>
          <CardHeader><CardTitle className="text-base" style={{ color: '#0f172a' }}>How programs are set up</CardTitle></CardHeader>
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
          <CardHeader><CardTitle className="text-base" style={{ color: '#0f172a' }}>Breakdowns</CardTitle></CardHeader>
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

      {/* The funnel: a pro who just benchmarked their program is the person who runs it. */}
      <div className="rounded-xl border border-teal-200 bg-teal-50 p-5">
        <div className="font-semibold text-slate-900">Charging less than your peers? Run a tighter program.</div>
        <p className="text-sm text-slate-600 mt-1">
          ClubMode is the director&apos;s back office: lessons and clinic sign-ups, mixers, team captains, stringing and court sheets in one place. Founding clubs use it free during beta and lock in founding pricing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/register?next=/start"><Button className="gap-1">Start free as a founding club</Button></Link>
          <Link href="/pricing"><Button variant="outline">See what&apos;s included</Button></Link>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Self-reported by pros, {r.contributors} so far. Medians and middle-half ranges, rounded. Updates live as more pros share.
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
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm"
        style={{ ...inputStyle, color: value ? '#0f172a' : '#94a3b8' }}
      >
        <option value="" disabled>Choose…</option>
        {options.map((o) => <option key={o.v} value={o.v} style={{ color: '#0f172a' }}>{o.l}</option>)}
      </select>
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

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, CheckCircle2, Loader2, Lock, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
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

const CASH = [
  { k: 'base_comp', label: 'Base salary' },
  { k: 'bonus', label: 'Bonus / incentive' },
  { k: 'housing', label: 'Housing or allowance' },
  { k: 'auto', label: 'Car / auto allowance' },
  { k: 'dues', label: 'Club dues / membership' },
  { k: 'healthcare', label: 'Healthcare value' },
  { k: 'retirement', label: 'Retirement / 401k match' },
  { k: 'other_amount', label: 'Other (cash value)' },
] as const;

export default function ProfilePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [agg, setAgg] = useState<any>(null);

  const [f, setF] = useState<Record<string, string>>({});
  const [dept, setDept] = useState('Tennis/Racquets');
  const [fullName, setFullName] = useState('');
  const [clubName, setClubName] = useState('');
  const [state, setState] = useState('');
  const [notes, setNotes] = useState('');
  const [vac, setVac] = useState('');
  const [sev, setSev] = useState('');
  const [ninetyBase, setNinetyBase] = useState<number | null>(null);
  const [claimedEin, setClaimedEin] = useState('');
  const [isPublic, setIsPublic] = useState(true);

  const [claimQuery, setClaimQuery] = useState('');
  const [claimResults, setClaimResults] = useState<any[]>([]);

  const num = (k: string) => Number(f[k] || 0) || 0;
  const total = CASH.reduce((s, c) => s + num(c.k), 0);
  const premium = ninetyBase && ninetyBase > 0 ? (total - ninetyBase) / ninetyBase : null;

  useEffect(() => {
    (async () => {
      const [pr, ar] = await Promise.all([fetch('/api/benchmarks/profile'), fetch('/api/benchmarks/profile/aggregate')]);
      if (pr.ok) {
        const { profile } = await pr.json();
        if (profile) {
          const nf: Record<string, string> = {};
          for (const c of CASH) nf[c.k] = profile[c.k] != null ? String(profile[c.k]) : '';
          setF(nf);
          setDept(profile.dept || 'Tennis/Racquets'); setFullName(profile.full_name || ''); setClubName(profile.club_name || '');
          setState(profile.state || ''); setNotes(profile.other_notes || ''); setVac(profile.vacation_weeks?.toString() || '');
          setSev(profile.severance_months?.toString() || ''); setNinetyBase(profile.ninety_base ?? null);
          setClaimedEin(profile.claimed_ein || ''); setIsPublic(profile.is_public ?? true);
        }
      }
      if (ar.ok) setAgg(await ar.json());
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (claimQuery.trim().length < 2) { setClaimResults([]); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/connect/benchmarks-search?q=${encodeURIComponent(claimQuery)}`);
      if (res.ok) setClaimResults((await res.json()).results || []);
    }, 250);
    return () => clearTimeout(t);
  }, [claimQuery]);

  function claim(r: any) {
    setFullName(r.name || ''); setClubName(r.club || ''); setDept(r.dept || dept);
    setState(r.state || ''); setNinetyBase(r.total || null); setClaimedEin(r.ein || '');
    setF((prev) => ({ ...prev, base_comp: r.total ? String(r.total) : (prev.base_comp || '') }));
    setClaimResults([]); setClaimQuery('');
  }

  async function save() {
    setSaving(true); setSavedMsg('');
    const body: any = { dept, full_name: fullName, club_name: clubName, state, other_notes: notes,
      vacation_weeks: vac || null, severance_months: sev || null, ninety_base: ninetyBase, claimed_ein: claimedEin || null, is_public: isPublic };
    for (const c of CASH) body[c.k] = num(c.k);
    const res = await fetch('/api/benchmarks/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    setSavedMsg(res.ok ? 'Saved — thank you for strengthening the dataset.' : 'Save failed.');
    setSaving(false);
  }

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;

  const tennisPrem = agg?.byDept?.['Tennis/Racquets']?.medianPremiumPct;

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/benchmarks" className="text-sm text-teal-700 underline">← Compensation Benchmarks</Link>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-2 mb-1">Your full package</h1>
      <p className="text-slate-600 mb-6">
        The 990 only shows base reportable comp. Add what it can't see — bonus, housing, dues, the works — to get your true number and benchmark the <em>whole</em> package, not just salary.
      </p>

      {agg?.total > 0 && tennisPrem != null && (
        <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-slate-700">
          Directors who've added their full package report a median total <strong>{Math.round(tennisPrem * 100)}% above</strong> their public 990 base.
        </div>
      )}

      {/* Claim your 990 */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4 text-teal-600" /> Start from your 990 record</CardTitle></CardHeader>
        <CardContent>
          <Input value={claimQuery} onChange={(e) => setClaimQuery(e.target.value)} placeholder="Search your name…" style={inputStyle} />
          {claimResults.length > 0 && (
            <div className="mt-2 border rounded-lg divide-y">
              {claimResults.map((r, i) => (
                <button key={i} onClick={() => claim(r)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="text-slate-500"> — {r.title}, {r.club} · {usd(r.total)} · {r.year}</span>
                </button>
              ))}
            </div>
          )}
          {ninetyBase != null && <p className="mt-2 text-xs text-teal-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> 990 base: {usd(ninetyBase)}{claimedEin ? ` · EIN ${claimedEin}` : ''}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} /></Field>
            <Field label="Club"><Input value={clubName} onChange={(e) => setClubName(e.target.value)} style={inputStyle} /></Field>
            <Field label="Role">
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            {CASH.map((c) => (
              <Field key={c.k} label={c.label}>
                <Input value={f[c.k] || ''} onChange={(e) => setF((p) => ({ ...p, [c.k]: e.target.value }))} placeholder="0" style={inputStyle} />
              </Field>
            ))}
            <Field label="Vacation (weeks)"><Input value={vac} onChange={(e) => setVac(e.target.value)} style={inputStyle} /></Field>
            <Field label="Severance (months)"><Input value={sev} onChange={(e) => setSev(e.target.value)} style={inputStyle} /></Field>
          </div>
          <Field label="Other notes (e.g. '10% of pro shop sales')"><Input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} /></Field>

          {/* Live total */}
          <div className="rounded-xl border bg-slate-50 p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500">Your total package</div>
              <div className="text-2xl font-bold text-slate-900">{usd(total)}</div>
            </div>
            {premium != null && premium > 0 && (
              <div className="text-right">
                <div className="text-xs text-slate-500">vs your 990 base of {usd(ninetyBase!)}</div>
                <div className="text-lg font-semibold text-teal-700">+{Math.round(premium * 100)}%</div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label className="text-slate-900 flex items-center gap-1"><Lock className="h-3 w-3" /> Include in anonymous benchmarks</Label>
              <p className="text-xs text-slate-500">Your numbers stay private; only blinded medians are ever shown. Off = stored for you only.</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>

          <div className="flex items-center gap-3 border-t pt-4">
            <Button onClick={save} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving…</> : 'Save my package'}</Button>
            {savedMsg && <span className="text-sm text-teal-700">{savedMsg}</span>}
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 rounded-xl border border-teal-200 bg-teal-50 p-5">
        <div className="font-semibold text-slate-900">Want better offers, not just a better number?</div>
        <p className="text-sm text-slate-600 mt-1">Opt into ClubMode Recruiting and clubs that can beat your package will quietly reach out.</p>
        <Link href="/connect/candidate"><Button className="mt-3 gap-1" variant="outline">Get found <ArrowRight className="h-4 w-4" /></Button></Link>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

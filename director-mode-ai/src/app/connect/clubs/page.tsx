'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search, MapPin, Mail, Phone, Building2, TrendingUp, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
const compact = (n: number) =>
  n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;

// Tolerant money parsing: "$150,000", "150k", "1.2m" all work.
function parseMoney(s: string): number {
  const raw = s.trim().toLowerCase().replace(/[$,\s]/g, '');
  const mult = raw.endsWith('m') ? 1_000_000 : raw.endsWith('k') ? 1_000 : 1;
  const n = Number(raw.replace(/[mk]$/, ''));
  return Number.isFinite(n) ? n * mult : 0;
}

type Opening = { id: string; club_name: string | null; title: string | null; dept: string; comp_min: number | null; comp_max: number; zip: string | null; status: string };
type Match = {
  id: string; status: string; comp_delta: number; distance_miles: number; opening_id: string;
  candidate: { headline: string | null; dept: string | null; years_experience: number | null; current_comp: number | null; home_zip: string | null; full_name: string | null; email: string | null; phone: string | null };
};
type Prospect = {
  name: string; ein: string; club: string; state: string; title: string; dept: string;
  comp: number; year: string; url: string | null; distanceMiles: number | null;
  fit: 'raise' | 'in_band' | 'stretch';
  likelyToMove: boolean; sizeExpected: number | null;
};
type Insight = {
  bandMax: number; median: number | null; p25: number | null; p75: number | null;
  verdict: 'strong' | 'competitive' | 'below'; headline: string; detail: string;
  prospectCount: number; sampleSize: number;
};

const FIT: Record<Prospect['fit'], { label: string; cls: string }> = {
  raise: { label: 'A raise for them', cls: 'bg-emerald-100 text-emerald-700' },
  in_band: { label: 'In your band', cls: 'bg-sky-100 text-sky-700' },
  stretch: { label: 'Slight stretch', cls: 'bg-amber-100 text-amber-700' },
};
const VERDICT: Record<Insight['verdict'], string> = {
  strong: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  competitive: 'border-sky-300 bg-sky-50 text-sky-900',
  below: 'border-amber-300 bg-amber-50 text-amber-900',
};

export default function ClubsPage() {
  const [loading, setLoading] = useState(true);
  const [openings, setOpenings] = useState<Opening[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const [clubName, setClubName] = useState('');
  const [dept, setDept] = useState('Tennis/Racquets');
  const [title, setTitle] = useState('');
  const [bandMin, setBandMin] = useState('');
  const [bandMax, setBandMax] = useState('');
  const [zip, setZip] = useState('');
  const [description, setDescription] = useState('');

  // Live benchmark-sourced suggestions + pay-band read
  const [insight, setInsight] = useState<Insight | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [prospectsBusy, setProspectsBusy] = useState(false);
  const reqId = useRef(0);
  const [introReqs, setIntroReqs] = useState<Record<string, 'sending' | 'done'>>({});

  async function requestIntro(p: Prospect) {
    const key = `${p.name}|${p.club}`;
    setIntroReqs((s) => ({ ...s, [key]: 'sending' }));
    try {
      await fetch('/api/connect/request-intro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prospect: { name: p.name, ein: p.ein, club: p.club, state: p.state, title: p.title, comp: p.comp, year: p.year, url: p.url },
          opening: { club_name: clubName, dept, title, comp_min: minNum || null, comp_max: maxNum || null },
        }),
      });
    } finally {
      setIntroReqs((s) => ({ ...s, [key]: 'done' }));
    }
  }

  async function load() {
    const res = await fetch('/api/connect/openings');
    if (res.ok) {
      const { openings, matches } = await res.json();
      setOpenings(openings || []);
      setMatches(matches || []);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Prefill from the Comp Advisor ("Take this opening to Recruiting").
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = q.get('dept'); if (d && DEPTS.some((x) => x.key === d)) setDept(d);
    const c = q.get('comp_max'); if (c) setBandMax(c);
    const cm = q.get('comp_min'); if (cm) setBandMin(cm);
    const z = q.get('zip'); if (z) setZip(z);
  }, []);

  const minNum = parseMoney(bandMin);
  const maxNum = parseMoney(bandMax);
  const zip5 = zip.replace(/\D/g, '').slice(0, 5);

  // Debounced live lookup as soon as we have dept + a valid ZIP + a band ceiling.
  useEffect(() => {
    if (!maxNum || zip5.length !== 5) { setInsight(null); setProspects([]); setProspectsBusy(false); return; }
    setProspectsBusy(true);
    const id = ++reqId.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/connect/prospects', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dept, zip: zip5, comp_min: minNum || null, comp_max: maxNum, radius: 150 }),
        });
        const data = res.ok ? await res.json() : { insight: null, prospects: [] };
        if (id === reqId.current) { setInsight(data.insight); setProspects(data.prospects || []); }
      } catch {
        if (id === reqId.current) { setInsight(null); setProspects([]); }
      } finally {
        if (id === reqId.current) setProspectsBusy(false);
      }
    }, 450);
    return () => clearTimeout(t);
  }, [dept, zip5, minNum, maxNum]);

  async function save() {
    setSaving(true);
    setMsg('');
    if (!maxNum) { setMsg('Enter the top of your pay band.'); setSaving(false); return; }
    const res = await fetch('/api/connect/opening', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ club_name: clubName, dept, title, comp_min: minNum || null, comp_max: maxNum, zip: zip5, description }),
    });
    if (res.ok) {
      const { newMatches } = await res.json();
      setMsg(newMatches > 0
        ? `Saved — and ${newMatches} opted-in director${newMatches === 1 ? '' : 's'} matched right away!`
        : 'Saved. We’ll email you the moment a director who fits your band opts in.');
      await load();
    } else {
      setMsg((await res.json().catch(() => ({}))).error || 'Failed.');
    }
    setSaving(false);
  }

  async function act(id: string, action: string) {
    await fetch(`/api/connect/match/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    await load();
  }

  async function setStatus(opening: Opening, status: string) {
    await fetch('/api/connect/opening', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: opening.id, club_name: opening.club_name, dept: opening.dept, title: opening.title, comp_min: opening.comp_min, comp_max: opening.comp_max, zip: opening.zip, status }),
    });
    await load();
  }

  if (loading) return <div className="max-w-4xl mx-auto px-4 py-16 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;

  const bandLabel = (o: Opening) => o.comp_min ? `${compact(o.comp_min)}–${compact(o.comp_max)}` : `up to ${usd(o.comp_max)}`;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/connect" className="text-sm text-teal-400 underline">← ClubMode Recruiting</Link>
      <h1 className="text-3xl font-bold tracking-tight text-white mt-2 mb-1">Find your next director</h1>
      <p className="text-slate-300 mb-8">
        This isn’t a public job post. Tell us what you’re hiring for and your pay band — we’ll instantly show directors from the benchmark database who fit,
        tell you how competitive your band is, and quietly alert you when one opts in to be contacted.
      </p>

      {/* Tell us about your opening */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4 text-teal-400" /> Tell us about your opening</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Club name"><Input value={clubName} onChange={(e) => setClubName(e.target.value)} placeholder="Sleepy Hollow Country Club" style={inputStyle} /></Field>
            <Field label="Position">
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Director of Racquets" style={inputStyle} /></Field>
            <Field label="Club ZIP"><Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10591" style={inputStyle} /></Field>
            <Field label="Pay band — low"><Input value={bandMin} onChange={(e) => setBandMin(e.target.value)} placeholder="150,000" style={inputStyle} /></Field>
            <Field label="Pay band — high"><Input value={bandMax} onChange={(e) => setBandMax(e.target.value)} placeholder="200,000" style={inputStyle} /></Field>
          </div>
          <Field label="What makes this a great seat? (optional)"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} /></Field>
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={save} disabled={saving || !maxNum}>{saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving…</> : 'Save this opening'}</Button>
            <span className="text-xs text-slate-400">Saving keeps it on file so we can alert you when a matching director opts in.</span>
          </div>
          {msg && <p className="text-sm text-teal-300">{msg}</p>}
        </CardContent>
      </Card>

      {/* Live pay-band read */}
      {(prospectsBusy || insight) && (
        <div className="mb-4">
          {insight && (
            <div className={`rounded-xl border p-4 ${VERDICT[insight.verdict]}`}>
              <div className="flex items-center gap-2 font-semibold"><TrendingUp className="h-4 w-4" /> {insight.headline}</div>
              <p className="text-sm mt-1">{insight.detail}</p>
              {insight.median != null && (
                <div className="mt-2 text-xs flex flex-wrap gap-x-4 gap-y-1 opacity-90">
                  <span>Market median: <strong>{usd(insight.median)}</strong></span>
                  {insight.p25 != null && <span>Middle 50%: <strong>{usd(insight.p25)}–{usd(insight.p75 || 0)}</strong></span>
                  }
                  <span>Based on {insight.sampleSize} recent filings for this role</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Suggested directors from the benchmark data */}
      {(prospectsBusy || prospects.length > 0 || (insight && zip5.length === 5)) && (
        <Card className="mb-8 bg-white">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <Sparkles className="h-4 w-4 text-teal-600" /> Directors who fit — from the benchmark data
              {prospectsBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500 mb-3">
              Public IRS-990 leaders in this role within ~150 mi whose current pay fits your band.
              <strong> ⚡ = underpaid for their club’s size</strong> (most likely to move). Tap <strong>Request intro</strong> and we’ll broker a warm introduction; save the opening and we’ll also alert you if they opt in.
            </p>
            {prospects.length === 0 && !prospectsBusy ? (
              <p className="text-sm text-slate-500">No directors in the benchmark data fit this band + area yet. Widening the top of your band or the location will surface more.</p>
            ) : (
              <div className="divide-y">
                {prospects.map((p, i) => {
                  const key = `${p.name}|${p.club}`;
                  const req = introReqs[key];
                  return (
                    <div key={`${p.name}-${p.club}-${i}`} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate flex items-center gap-1.5 flex-wrap">
                          {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">{p.name}</a> : <span>{p.name}</span>}
                          <span className="text-slate-600 font-normal">· {p.title}</span>
                          {p.likelyToMove && (
                            <span className="text-[11px] font-medium rounded-full px-2 py-0.5 bg-orange-100 text-orange-700" title={p.sizeExpected ? `Underpaid for their club's size — similar clubs pay ~${usd(p.sizeExpected)}` : 'Underpaid for their club’s size'}>
                              ⚡ Likely to move
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 truncate flex flex-wrap gap-x-2">
                          <span>{p.club} ({p.state})</span>
                          {p.distanceMiles != null && <span><MapPin className="h-3 w-3 inline" /> {p.distanceMiles} mi</span>}
                          <span>earns {usd(p.comp)} ({p.year})</span>
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${FIT[p.fit].cls}`}>{FIT[p.fit].label}</span>
                        <button
                          onClick={() => requestIntro(p)}
                          disabled={!!req}
                          className="text-xs font-medium text-teal-700 hover:text-teal-900 disabled:text-emerald-600 disabled:cursor-default"
                        >
                          {req === 'done' ? '✓ Intro requested' : req === 'sending' ? 'Requesting…' : 'Request intro'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!maxNum && (
        <p className="text-sm text-slate-400 mb-8">Enter a position, ZIP, and pay band above to see matching directors instantly.</p>
      )}

      {/* Existing openings */}
      {openings.length > 0 && (
        <div className="mb-8 space-y-2">
          <h2 className="text-lg font-semibold text-white">Your saved openings</h2>
          {openings.map((o) => (
            <Card key={o.id} className="bg-white">
              <CardContent className="py-3 flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{o.title || o.dept}</span>
                  <span className="text-slate-500"> · {bandLabel(o)} · {o.zip || '—'} · {o.status}</span>
                </div>
                {o.status === 'open' && <Button size="sm" variant="outline" onClick={() => setStatus(o, 'filled')}>Mark filled</Button>}
                {o.status !== 'open' && <Button size="sm" variant="ghost" onClick={() => setStatus(o, 'open')}>Reopen</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Opted-in matches */}
      <h2 className="text-xl font-semibold text-white mb-3">Directors who opted in</h2>
      {matches.filter((m) => m.status !== 'club_dismissed').length === 0 ? (
        <p className="text-slate-400 text-sm">None yet. The prospects above are public records; this list fills in as directors join ClubMode and opt into being contacted for a band like yours.</p>
      ) : (
        <div className="space-y-3">
          {matches.filter((m) => m.status !== 'club_dismissed').map((m) => (
            <Card key={m.id} className="bg-white">
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-slate-900">{m.candidate.headline || m.candidate.dept || 'Director'}</div>
                    <div className="text-sm text-slate-500 flex flex-wrap gap-x-3">
                      <span><MapPin className="h-3 w-3 inline" /> {Math.round(m.distance_miles)} mi away</span>
                      {m.candidate.years_experience != null && <span>{m.candidate.years_experience} yrs exp</span>}
                      <span className="text-emerald-700">{usd(m.comp_delta)} below your ceiling</span>
                    </div>
                    {m.status === 'revealed' && (m.candidate.email || m.candidate.phone) ? (
                      <div className="mt-2 text-sm text-slate-800 bg-emerald-50 rounded-md px-3 py-2 inline-block">
                        <span className="font-medium">{m.candidate.full_name}</span>{' '}
                        {m.candidate.email && <a href={`mailto:${m.candidate.email}`} className="text-teal-700 underline ml-1"><Mail className="h-3 w-3 inline" /> {m.candidate.email}</a>}
                        {m.candidate.phone && <span className="ml-2"><Phone className="h-3 w-3 inline" /> {m.candidate.phone}</span>}
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-500 italic">Approve-first candidate — contact unlocks when they accept.</div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => act(m.id, 'dismiss')}>Dismiss</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-slate-300 mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

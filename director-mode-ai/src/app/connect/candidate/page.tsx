'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, CheckCircle2, Loader2 } from 'lucide-react';
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

type Match = {
  id: string; status: string; comp_delta: number; distance_miles: number;
  opening: { club_name: string | null; title: string | null; dept: string; comp_max: number; status: string } | null;
};

export default function CandidatePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [headline, setHeadline] = useState('');
  const [dept, setDept] = useState('Tennis/Racquets');
  const [years, setYears] = useState('');
  const [currentComp, setCurrentComp] = useState('');
  const [homeZip, setHomeZip] = useState('');
  const [radius, setRadius] = useState('50');
  const [openToWork, setOpenToWork] = useState(true);
  const [revealMode, setRevealMode] = useState<'auto' | 'approve'>('auto');
  const [claimedEin, setClaimedEin] = useState('');

  // Claim-990 typeahead
  const [claimQuery, setClaimQuery] = useState('');
  const [claimResults, setClaimResults] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/connect/candidate');
      if (res.ok) {
        const { candidate, matches } = await res.json();
        if (candidate) {
          setFullName(candidate.full_name || '');
          setEmail(candidate.email || '');
          setPhone(candidate.phone || '');
          setHeadline(candidate.headline || '');
          setDept(candidate.dept || 'Tennis/Racquets');
          setYears(candidate.years_experience?.toString() || '');
          setCurrentComp(candidate.current_comp?.toString() || '');
          setHomeZip(candidate.home_zip || '');
          setRadius(candidate.radius_miles?.toString() || '50');
          setOpenToWork(candidate.open_to_work ?? true);
          setRevealMode(candidate.reveal_mode === 'approve' ? 'approve' : 'auto');
          setClaimedEin(candidate.claimed_ein || '');
        }
        setMatches(matches || []);
      }
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
    setFullName(r.name || '');
    setDept(r.dept || dept);
    setHeadline(`${r.title || 'Director'} at ${r.club}`);
    if (r.total) setCurrentComp(String(r.total));
    if (r.zip) setHomeZip(r.zip);
    setClaimedEin(r.ein || '');
    setClaimResults([]);
    setClaimQuery('');
  }

  async function save() {
    setSaving(true);
    setSavedMsg('');
    const res = await fetch('/api/connect/candidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName, email, phone, headline, dept,
        years_experience: years ? Number(years) : null,
        current_comp: currentComp ? Number(currentComp) : null,
        home_zip: homeZip, radius_miles: radius ? Number(radius) : 50,
        open_to_work: openToWork, reveal_mode: revealMode, claimed_ein: claimedEin || null,
      }),
    });
    if (res.ok) {
      const { newMatches } = await res.json();
      setSavedMsg(newMatches > 0 ? `Saved — and you matched ${newMatches} new opening${newMatches === 1 ? '' : 's'}!` : 'Saved.');
      const re = await fetch('/api/connect/candidate');
      if (re.ok) setMatches((await re.json()).matches || []);
    } else {
      const e = await res.json().catch(() => ({}));
      setSavedMsg(e.error || 'Save failed.');
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/connect" className="text-sm text-teal-700 underline">← ClubMode Connect</Link>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-2 mb-1">Your candidate profile</h1>
      <p className="text-slate-600 mb-8">
        You stay anonymous. A club only gets your contact info when they post an opening that beats your current comp and is within your range.
      </p>

      {/* Claim your 990 record */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4 text-teal-600" /> Claim your 990 record (optional prefill)</CardTitle></CardHeader>
        <CardContent>
          <Input value={claimQuery} onChange={(e) => setClaimQuery(e.target.value)} placeholder="Search your name in the comp dataset…" style={inputStyle} />
          {claimResults.length > 0 && (
            <div className="mt-2 border rounded-lg divide-y">
              {claimResults.map((r, i) => (
                <button key={i} onClick={() => claim(r)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="text-slate-500"> — {r.title}, {r.club} ({r.state}) · {usd(r.total)} · {r.year}</span>
                </button>
              ))}
            </div>
          )}
          {claimedEin && <p className="mt-2 text-xs text-teal-700 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Prefilled from EIN {claimedEin}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Full name"><Input value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} /></Field>
            <Field label="Email (released on match)"><Input value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} /></Field>
            <Field label="Phone (optional)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} /></Field>
            <Field label="Position">
              <Select value={dept} onValueChange={setDept}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{DEPTS.map((d) => <SelectItem key={d.key} value={d.key}>{d.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Headline (shown anonymously)"><Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Director of Tennis, 12 yrs, Northeast" style={inputStyle} /></Field>
            <Field label="Years experience"><Input value={years} onChange={(e) => setYears(e.target.value)} style={inputStyle} /></Field>
            <Field label="Current total comp ($)"><Input value={currentComp} onChange={(e) => setCurrentComp(e.target.value)} placeholder="150000" style={inputStyle} /></Field>
            <Field label="Home ZIP"><Input value={homeZip} onChange={(e) => setHomeZip(e.target.value)} placeholder="10591" style={inputStyle} /></Field>
            <Field label="Willing to relocate (mi)"><Input value={radius} onChange={(e) => setRadius(e.target.value)} style={inputStyle} /></Field>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label className="text-slate-900">Open to work</Label>
              <p className="text-xs text-slate-500">Turn off to pause all matching without deleting your profile.</p>
            </div>
            <Switch checked={openToWork} onCheckedChange={setOpenToWork} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-slate-900">Reveal mode</Label>
              <p className="text-xs text-slate-500">{revealMode === 'auto' ? 'Auto: clubs get your contact the moment you match.' : 'Approve-first: you confirm before any club sees your contact.'}</p>
            </div>
            <Select value={revealMode} onValueChange={(v) => setRevealMode(v as any)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-reveal on match</SelectItem>
                <SelectItem value="approve">Approve first</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3 border-t pt-4">
            <Button onClick={save} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving…</> : 'Save profile'}</Button>
            {savedMsg && <span className="text-sm text-teal-700">{savedMsg}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Matches / interested clubs */}
      <h2 className="text-xl font-semibold text-slate-900 mt-10 mb-3">Clubs interested in you</h2>
      {matches.length === 0 ? (
        <p className="text-slate-500 text-sm">No matches yet. When a club posts an opening that fits, it shows up here.</p>
      ) : (
        <div className="space-y-3">
          {matches.map((m) => (
            <Card key={m.id}>
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div>
                  <div className="font-medium text-slate-900">{m.opening?.club_name || 'A club'} — {m.opening?.title || m.opening?.dept}</div>
                  <div className="text-sm text-slate-500">Up to {usd(m.opening?.comp_max || 0)} · {Math.round(m.distance_miles)} mi · {usd(m.comp_delta)} above your comp</div>
                </div>
                {m.status === 'pending_candidate' ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act(m.id, 'approve')}>Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => act(m.id, 'decline')}>Pass</Button>
                  </div>
                ) : (
                  <span className="text-xs rounded-full px-2 py-1 bg-slate-100 text-slate-600">{statusLabel(m.status)}</span>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  async function act(id: string, action: string) {
    await fetch(`/api/connect/match/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    });
    const re = await fetch('/api/connect/candidate');
    if (re.ok) setMatches((await re.json()).matches || []);
  }
}

function statusLabel(s: string) {
  return s === 'revealed' ? 'Contact shared' : s === 'candidate_declined' ? 'You passed' : s === 'club_dismissed' ? 'Club closed' : s;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

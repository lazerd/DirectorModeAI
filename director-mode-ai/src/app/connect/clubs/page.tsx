'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, MapPin, Mail, Phone } from 'lucide-react';
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

type Opening = { id: string; club_name: string | null; title: string | null; dept: string; comp_max: number; zip: string | null; status: string };
type Match = {
  id: string; status: string; comp_delta: number; distance_miles: number; opening_id: string;
  candidate: { headline: string | null; dept: string | null; years_experience: number | null; current_comp: number | null; home_zip: string | null; full_name: string | null; email: string | null; phone: string | null };
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
  const [compMax, setCompMax] = useState('');
  const [zip, setZip] = useState('');
  const [description, setDescription] = useState('');

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

  async function post() {
    setSaving(true);
    setMsg('');
    const res = await fetch('/api/connect/opening', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ club_name: clubName, dept, title, comp_max: compMax ? Number(compMax) : null, zip, description }),
    });
    if (res.ok) {
      const { newMatches } = await res.json();
      setMsg(newMatches > 0 ? `Posted — ${newMatches} candidate${newMatches === 1 ? '' : 's'} matched right away!` : 'Posted. We\'ll notify you the moment a candidate matches.');
      setTitle(''); setCompMax(''); setDescription('');
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
      body: JSON.stringify({ id: opening.id, club_name: opening.club_name, dept: opening.dept, title: opening.title, comp_max: opening.comp_max, zip: opening.zip, status }),
    });
    await load();
  }

  if (loading) return <div className="max-w-4xl mx-auto px-4 py-16 text-center text-slate-500"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <Link href="/connect" className="text-sm text-teal-700 underline">← ClubMode Connect</Link>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900 mt-2 mb-1">Find your next director</h1>
      <p className="text-slate-600 mb-8">Post what you can pay. We surface qualified, nearby directors who'd move for it — with their contact info, because they opted in.</p>

      {/* Post an opening */}
      <Card className="mb-8">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4 text-teal-600" /> Post an opening</CardTitle></CardHeader>
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
            <Field label="Comp you can pay ($)"><Input value={compMax} onChange={(e) => setCompMax(e.target.value)} placeholder="200000" style={inputStyle} /></Field>
            <Field label="Club ZIP"><Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="10591" style={inputStyle} /></Field>
          </div>
          <Field label="Description (optional)"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} /></Field>
          <div className="flex items-center gap-3">
            <Button onClick={post} disabled={saving}>{saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Posting…</> : 'Post opening'}</Button>
            {msg && <span className="text-sm text-teal-700">{msg}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Existing openings */}
      {openings.length > 0 && (
        <div className="mb-8 space-y-2">
          <h2 className="text-lg font-semibold text-slate-900">Your openings</h2>
          {openings.map((o) => (
            <Card key={o.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="text-sm">
                  <span className="font-medium text-slate-900">{o.title || o.dept}</span>
                  <span className="text-slate-500"> · up to {usd(o.comp_max)} · {o.zip || '—'} · {o.status}</span>
                </div>
                {o.status === 'open' && <Button size="sm" variant="outline" onClick={() => setStatus(o, 'filled')}>Mark filled</Button>}
                {o.status !== 'open' && <Button size="sm" variant="ghost" onClick={() => setStatus(o, 'open')}>Reopen</Button>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Match inbox */}
      <h2 className="text-xl font-semibold text-slate-900 mb-3">Your matches</h2>
      {matches.filter((m) => m.status !== 'club_dismissed').length === 0 ? (
        <p className="text-slate-500 text-sm">No matches yet. Post an opening above and we'll surface qualified directors here.</p>
      ) : (
        <div className="space-y-3">
          {matches.filter((m) => m.status !== 'club_dismissed').map((m) => (
            <Card key={m.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-slate-900">{m.candidate.headline || m.candidate.dept || 'Director'}</div>
                    <div className="text-sm text-slate-500 flex flex-wrap gap-x-3">
                      <span><MapPin className="h-3 w-3 inline" /> {Math.round(m.distance_miles)} mi away</span>
                      {m.candidate.years_experience != null && <span>{m.candidate.years_experience} yrs exp</span>}
                      <span className="text-emerald-700">{usd(m.comp_delta)} below your offer</span>
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
      <Label className="text-xs text-slate-500 mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

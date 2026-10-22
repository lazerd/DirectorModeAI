'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, CheckCircle2, Loader2, TrendingUp, MapPin, FileText, Upload, Briefcase, Mail, Copy, Users, Trash2, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { STAGE_LABEL, isStage, candidateCanMove } from '@/lib/connect/placement';
import { normalizeRefCode, referralPath } from '@/lib/connect/referrals';
import { PRIVACY_PATH } from '@/lib/connect/privacy';
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
function parseMoney(s: string): number {
  const raw = s.trim().toLowerCase().replace(/[$,\s]/g, '');
  const mult = raw.endsWith('m') ? 1_000_000 : raw.endsWith('k') ? 1_000 : 1;
  const n = Number(raw.replace(/[mk]$/, ''));
  return Number.isFinite(n) ? n * mult : 0;
}

type ClubOpp = {
  club: string; state: string; revenue: number; distanceMiles: number | null;
  sizeExpected: number; upside: number; currentTopComp: number; year: string; url: string | null;
};

type Interest = {
  id: string; club_name: string | null; role: string | null;
  comp_min: number | null; comp_max: number | null; prospect_title: string | null; created_at: string;
};

type Match = {
  id: string; status: string; comp_delta: number; distance_miles: number;
  opening: { club_name: string | null; title: string | null; dept: string; comp_max: number; status: string } | null;
};

type Application = {
  id: string; opening_id: string; source: string; stage: string; invited_at: string | null; updated_at: string;
  opening: {
    id: string; club_name: string | null; title: string | null; dept: string;
    comp_min: number | null; comp_max: number | null; city: string | null; state: string | null; status: string;
  } | null;
};

const stageLabel = (s: string) => (isStage(s) ? STAGE_LABEL[s] : s);
const canWithdraw = (s: string) => isStage(s) && s !== 'invited' && candidateCanMove(s, 'withdrawn');

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
  const [hasProfile, setHasProfile] = useState(false);

  // Founding network: this person's private invite link, and the ref they arrived with.
  const [referral, setReferral] = useState<{ code: string; joined: number } | null>(null);
  const [arrivedRef, setArrivedRef] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState('');

  // Recruiting: what clubs see when you apply.
  const [experienceSummary, setExperienceSummary] = useState('');
  const [certifications, setCertifications] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [resumeName, setResumeName] = useState<string | null>(null);
  const [resumeAt, setResumeAt] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeMsg, setResumeMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const [applications, setApplications] = useState<Application[]>([]);
  const [appBusy, setAppBusy] = useState<string | null>(null);
  const [appMsg, setAppMsg] = useState<Record<string, string>>({});
  const [inviteConsent, setInviteConsent] = useState<Record<string, boolean>>({});
  async function loadApplications() {
    try {
      const res = await fetch('/api/connect/applications/mine');
      if (res.ok) setApplications((await res.json()).applications || []);
    } catch { /* ignore */ }
  }
  async function uploadResume(file: File) {
    setResumeMsg('');
    if (!/\.(pdf|docx?)$/i.test(file.name)) { setResumeMsg('Résumé must be a PDF, DOC or DOCX.'); return; }
    if (file.size > 5 * 1024 * 1024) { setResumeMsg('Résumé must be 5 MB or smaller.'); return; }
    setResumeBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/connect/candidate/resume', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setResumeName(data.resume_filename || file.name);
        setResumeAt(data.resume_uploaded_at || new Date().toISOString());
        setResumeMsg('Résumé uploaded.');
      } else {
        setResumeMsg(data.error || 'Upload failed.');
      }
    } catch {
      setResumeMsg('Upload failed.');
    } finally {
      setResumeBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function viewResume() {
    // Open the tab synchronously so pop-up blockers allow it, then point it at the signed URL.
    const w = window.open('', '_blank');
    const res = await fetch('/api/connect/candidate/resume');
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      if (w) w.location.href = data.url; else window.location.href = data.url;
    } else {
      w?.close();
      setResumeMsg(data.error || 'Could not open résumé.');
    }
  }
  async function withdraw(id: string) {
    if (!confirm('Withdraw? If you already applied, the club will see that you withdrew.')) return;
    setAppBusy(id);
    const res = await fetch(`/api/connect/applications/${id}/withdraw`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setAppMsg((m) => ({ ...m, [id]: res.ok ? '' : data.error || 'Could not withdraw.' }));
    await loadApplications();
    setAppBusy(null);
  }
  async function applyToInvite(app: Application) {
    if (!inviteConsent[app.id]) {
      setAppMsg((m) => ({ ...m, [app.id]: 'Check the box to authorize sending your application.' }));
      return;
    }
    setAppBusy(app.id);
    const res = await fetch(`/api/connect/jobs/${app.opening_id}/apply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }),
    });
    const data = await res.json().catch(() => ({}));
    setAppMsg((m) => ({ ...m, [app.id]: res.ok ? 'Application sent.' : data.error || 'Could not apply.' }));
    await loadApplications();
    setAppBusy(null);
  }

  // Claim-990 typeahead
  const [claimQuery, setClaimQuery] = useState('');
  const [claimResults, setClaimResults] = useState<any[]>([]);
  const [claimBusy, setClaimBusy] = useState(false);
  const [claimSearched, setClaimSearched] = useState(false);

  // Clubs that flagged interest in this director as a public prospect.
  const [interests, setInterests] = useState<Interest[]>([]);
  async function loadInterests() {
    try {
      const res = await fetch('/api/connect/prospect-interests');
      if (res.ok) setInterests((await res.json()).interests || []);
    } catch { /* ignore */ }
  }
  async function actInterest(id: string, action: 'accept' | 'dismiss') {
    setInterests((s) => s.filter((x) => x.id !== id)); // optimistic
    await fetch(`/api/connect/prospect-interests/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    }).catch(() => {});
  }

  // "Clubs near you that can pay more" — the reason to opt in.
  const [clubOpps, setClubOpps] = useState<ClubOpp[]>([]);
  const [oppsBusy, setOppsBusy] = useState(false);
  const oppReq = useRef(0);
  const compNum = parseMoney(currentComp);
  const homeZip5 = homeZip.replace(/\D/g, '').slice(0, 5);

  useEffect(() => {
    if (!compNum || homeZip5.length !== 5) { setClubOpps([]); setOppsBusy(false); return; }
    setOppsBusy(true);
    const id = ++oppReq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/benchmarks/club-openings', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dept, current_comp: compNum, zip: homeZip5, radius: 150 }),
        });
        const data = res.ok ? await res.json() : { clubs: [] };
        if (id === oppReq.current) setClubOpps(data.clubs || []);
      } catch {
        if (id === oppReq.current) setClubOpps([]);
      } finally {
        if (id === oppReq.current) setOppsBusy(false);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [dept, compNum, homeZip5]);

  useEffect(() => {
    try {
      setArrivedRef(normalizeRefCode(new URLSearchParams(window.location.search).get('ref')));
    } catch { /* ignore */ }
    (async () => {
      const res = await fetch('/api/connect/candidate');
      if (res.ok) {
        const { candidate, matches, referral: ref } = await res.json();
        setReferral(ref || null);
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
          setExperienceSummary(candidate.experience_summary || '');
          setCertifications(candidate.certifications || '');
          setLinkedinUrl(candidate.linkedin_url || '');
          setResumeName(candidate.resume_filename || null);
          setResumeAt(candidate.resume_uploaded_at || null);
          setHasProfile(true);
        }
        setMatches(matches || []);
      }
      loadInterests();
      loadApplications();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const q = claimQuery.trim();
    if (q.length < 2) { setClaimResults([]); setClaimSearched(false); setClaimBusy(false); return; }
    setClaimBusy(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/connect/benchmarks-search?q=${encodeURIComponent(q)}`);
        setClaimResults(res.ok ? (await res.json()).results || [] : []);
      } catch {
        setClaimResults([]);
      } finally {
        setClaimBusy(false);
        setClaimSearched(true);
      }
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
        experience_summary: experienceSummary, certifications, linkedin_url: linkedinUrl,
        ...(arrivedRef ? { ref: arrivedRef } : {}),
      }),
    });
    if (res.ok) {
      const { newMatches } = await res.json();
      setHasProfile(true);
      setSavedMsg(newMatches > 0 ? `Saved — and you matched ${newMatches} new opening${newMatches === 1 ? '' : 's'}!` : 'Saved.');
      const re = await fetch('/api/connect/candidate');
      if (re.ok) {
        const d = await re.json();
        setMatches(d.matches || []);
        setReferral(d.referral || null);
      }
      loadInterests(); // claiming a 990 record can reveal clubs that asked for you
    } else {
      const e = await res.json().catch(() => ({}));
      setSavedMsg(e.error || 'Save failed.');
    }
    setSaving(false);
  }

  const inviteUrl = referral && typeof window !== 'undefined' ? `${window.location.origin}${referralPath(referral.code)}` : '';
  async function copyInvite() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy your invite link:', inviteUrl);
    }
  }

  async function deleteProfile() {
    if (!confirm('Delete your candidate profile and résumé? This erases your details and every résumé file, and withdraws your open applications. It can’t be undone.')) return;
    setDeleting(true);
    setDeleteMsg('');
    try {
      const res = await fetch('/api/connect/candidate', { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setDeleteMsg(data.error || 'Could not delete. Please try again.'); return; }
      setFullName(''); setEmail(''); setPhone(''); setHeadline(''); setYears(''); setCurrentComp(''); setHomeZip('');
      setRadius('50'); setClaimedEin(''); setExperienceSummary(''); setCertifications(''); setLinkedinUrl('');
      setResumeName(null); setResumeAt(null); setHasProfile(false); setReferral(null); setMatches([]); setInterests([]);
      setApplications([]); setSavedMsg('');
      setDeleteMsg('Deleted. Your profile details and résumé are gone, and your open applications were withdrawn.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-300"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/connect" className="text-sm text-teal-400 underline">← ClubMode Recruiting</Link>
      <h1 className="text-3xl font-bold tracking-tight text-white mt-2 mb-1">Your candidate profile</h1>
      <p className="text-slate-300 mb-2">
        You stay anonymous. A club only gets your contact info when they post an opening that beats your current comp and is within your range.
      </p>
      <p className="text-sm text-slate-400 mb-8 flex items-center gap-1.5">
        <ShieldCheck className="h-4 w-4" /> Free and confidential. Your current pay is never shown to clubs.{' '}
        <Link href={PRIVACY_PATH} className="text-teal-400 underline">Privacy notice</Link>
      </p>
      {deleteMsg && !hasProfile && <p className="mb-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">{deleteMsg}</p>}

      {/* Founding network: private invite link */}
      {referral && (
        <div className="mb-6 rounded-xl border border-teal-400/30 bg-teal-400/10 p-4">
          <div className="font-semibold text-white flex items-center gap-2"><Users className="h-4 w-4 text-teal-300" /> Share with two colleagues you&apos;d recommend</div>
          <p className="text-sm text-slate-300 mt-1">
            The network is only as good as the directors in it. Send your private invite link to two people you&apos;d vouch for.
            They make their own profile; nothing is shared about you.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="max-w-full truncate rounded-md bg-black/30 px-3 py-2 text-sm text-teal-100">{inviteUrl}</code>
            <Button size="sm" onClick={copyInvite}><Copy className="h-4 w-4 mr-1" /> {copied ? 'Copied' : 'Copy link'}</Button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {referral.joined > 0 ? `${referral.joined} colleague${referral.joined === 1 ? ' has' : 's have'} joined with your link.` : 'No one has joined with your link yet.'}
          </p>
        </div>
      )}

      {/* Clubs that invited this candidate to apply */}
      {applications.filter((a) => a.stage === 'invited').map((a) => (
        <div key={a.id} className="mb-4 rounded-xl border border-teal-300 bg-teal-50 p-4">
          <div className="font-semibold text-teal-900 flex items-center gap-2"><Mail className="h-4 w-4" /> A club invited you to apply</div>
          <p className="text-sm text-teal-800 mt-0.5">
            <span className="font-medium">{a.opening?.club_name || 'A club'}</span> · {a.opening?.title || a.opening?.dept}
            {a.opening?.comp_max ? ` · ${a.opening.comp_min ? `${usd(a.opening.comp_min)}–${usd(a.opening.comp_max)}` : `up to ${usd(a.opening.comp_max)}`}` : ''}
            {a.opening?.city || a.opening?.state ? ` · ${[a.opening?.city, a.opening?.state].filter(Boolean).join(', ')}` : ''}
          </p>
          <p className="text-xs text-teal-800 mt-1">The club hasn&apos;t seen your details. Nothing is shared unless you apply.</p>
          {!resumeName ? (
            <p className="text-sm text-teal-900 mt-3">Upload your résumé below to apply.</p>
          ) : (
            <>
              <label className="flex items-start gap-2 mt-3 text-sm text-slate-800">
                <input
                  type="checkbox" className="mt-1"
                  checked={!!inviteConsent[a.id]}
                  onChange={(e) => setInviteConsent((c) => ({ ...c, [a.id]: e.target.checked }))}
                />
                <span>
                  I authorize ClubMode to send my application and résumé to {a.opening?.club_name || 'this club'} for this role.{' '}
                  <Link href={PRIVACY_PATH} className="underline">Privacy</Link>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Button size="sm" onClick={() => applyToInvite(a)} disabled={appBusy === a.id}>
                  {appBusy === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                </Button>
                <Link href={`/connect/jobs/${a.opening_id}`} className="text-sm text-teal-800 underline">View job</Link>
                <Button size="sm" variant="ghost" className="text-slate-600" onClick={() => withdraw(a.id)} disabled={appBusy === a.id}>No thanks</Button>
              </div>
            </>
          )}
          {appMsg[a.id] && <p className="text-sm text-teal-900 mt-2">{appMsg[a.id]}</p>}
        </div>
      ))}

      {/* Clubs that asked to talk to you (matched to your claimed 990 record) */}
      {interests.length > 0 && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
          <div className="font-semibold text-emerald-900">
            {interests.length} club{interests.length === 1 ? '' : 's'} asked to talk to you 🎉
          </div>
          <p className="text-sm text-emerald-800 mt-0.5 mb-3">
            They found you in the comp data and want to connect. Accept to share your contact, or pass — you stay anonymous until you accept.
          </p>
          <div className="space-y-2">
            {interests.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 bg-white rounded-lg px-3 py-2">
                <div className="min-w-0 text-sm">
                  <span className="font-medium text-slate-900">{it.club_name || 'A club'}</span>
                  <span className="text-slate-500"> · {it.role || 'a leadership role'}{it.comp_max ? ` · ${it.comp_min ? `${usd(it.comp_min)}–${usd(it.comp_max)}` : `up to ${usd(it.comp_max)}`}` : ''}</span>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button size="sm" onClick={() => actInterest(it.id, 'accept')}>Accept</Button>
                  <Button size="sm" variant="ghost" onClick={() => actInterest(it.id, 'dismiss')}>Pass</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Claim your 990 record */}
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Search className="h-4 w-4 text-teal-600" /> Claim your 990 record (optional prefill)</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-slate-300 mb-2">
            Optional shortcut: if your comp is in the public IRS filings, pick it to auto-fill your profile. If not, skip this and fill in the form below — then hit <strong>Save profile</strong>.
          </p>
          <div className="relative">
            <Input value={claimQuery} onChange={(e) => setClaimQuery(e.target.value)} placeholder="Start typing your name…" style={inputStyle} />
            {claimBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />}
          </div>
          {claimResults.length > 0 && (
            <div className="mt-2 border rounded-lg divide-y bg-white">
              {claimResults.map((r, i) => (
                <button key={i} onClick={() => claim(r)} className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm">
                  <span className="font-medium text-slate-900">{r.name}</span>
                  <span className="text-slate-500"> — {r.title}, {r.club} ({r.state}) · {usd(r.total)} · {r.year}</span>
                </button>
              ))}
            </div>
          )}
          {!claimBusy && claimSearched && claimResults.length === 0 && !claimedEin && (
            <p className="mt-2 text-xs text-slate-300">
              No public 990 record found for “{claimQuery.trim()}”. That’s normal — the filings only list each club’s few highest-paid people. Just fill in your details below.
            </p>
          )}
          {claimedEin && <p className="mt-2 text-xs text-teal-300 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Prefilled from EIN {claimedEin}. Review the fields below, then Save.</p>}
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

          <div className="border-t pt-4 space-y-4">
            <Field label="Experience summary (sent to clubs you apply to)">
              <Textarea
                value={experienceSummary} onChange={(e) => setExperienceSummary(e.target.value)} rows={5}
                placeholder="Programs you've built or run, staff you've managed, member count, revenue you grew, events…"
                style={inputStyle}
              />
            </Field>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Certifications"><Input value={certifications} onChange={(e) => setCertifications(e.target.value)} placeholder="USPTA Elite, PTR Professional…" style={inputStyle} /></Field>
              <Field label="LinkedIn (optional)"><Input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="linkedin.com/in/you" style={inputStyle} /></Field>
            </div>
          </div>

          <div className="flex items-center justify-between border-t pt-4">
            <div>
              <Label className="text-slate-100">Open to work</Label>
              <p className="text-xs text-slate-300">Turn off to pause all matching without deleting your profile.</p>
            </div>
            <Switch checked={openToWork} onCheckedChange={setOpenToWork} />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-slate-100">Reveal mode</Label>
              <p className="text-xs text-slate-300">{revealMode === 'auto' ? 'Auto: clubs get your contact the moment you match.' : 'Approve-first: you confirm before any club sees your contact.'}</p>
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
            {savedMsg && <span className="text-sm text-teal-300">{savedMsg}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Résumé */}
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base flex items-center gap-2 text-white"><FileText className="h-4 w-4 text-teal-400" /> Résumé</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-slate-300 mb-3">
            PDF, DOC or DOCX, up to 5 MB. Private: it only goes to a club when you apply to that club&apos;s job.{' '}
            <Link href={PRIVACY_PATH} className="text-teal-400 underline">Privacy</Link>
          </p>
          {!hasProfile ? (
            <p className="text-sm text-slate-300">Save your profile above first, then upload your résumé.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {resumeName ? (
                <span className="text-sm text-slate-100">
                  <button onClick={viewResume} className="text-teal-300 underline">{resumeName}</button>
                  {resumeAt && <span className="text-slate-400"> · uploaded {new Date(resumeAt).toLocaleDateString()}</span>}
                </span>
              ) : (
                <span className="text-sm text-slate-400">No résumé on file.</span>
              )}
              <input
                ref={fileRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadResume(f); }}
              />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={resumeBusy}>
                {resumeBusy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                {resumeName ? 'Replace' : 'Upload résumé'}
              </Button>
            </div>
          )}
          {resumeMsg && <p className="text-sm text-teal-300 mt-2">{resumeMsg}</p>}
        </CardContent>
      </Card>

      {/* My applications */}
      <div className="flex items-center justify-between mt-10 mb-3">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2"><Briefcase className="h-5 w-5 text-teal-400" /> My applications</h2>
        <Link href="/connect/jobs" className="text-sm text-teal-400 underline">Browse jobs</Link>
      </div>
      {applications.filter((a) => a.stage !== 'invited').length === 0 ? (
        <p className="text-slate-400 text-sm">You haven&apos;t applied to any jobs yet. Applying is free.</p>
      ) : (
        <div className="space-y-3">
          {applications.filter((a) => a.stage !== 'invited').map((a) => (
            <Card key={a.id} className="bg-white">
              <CardContent className="py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <Link href={`/connect/jobs/${a.opening_id}`} className="font-medium text-slate-900 hover:underline">
                    {a.opening?.club_name || 'A club'} — {a.opening?.title || a.opening?.dept}
                  </Link>
                  <div className="text-sm text-slate-500">
                    Updated {new Date(a.updated_at).toLocaleDateString()}
                    {a.opening && a.opening.status !== 'open' ? ' · job closed' : ''}
                  </div>
                  {appMsg[a.id] && <div className="text-sm text-red-600">{appMsg[a.id]}</div>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs rounded-full px-2 py-1 bg-slate-100 text-slate-700">{stageLabel(a.stage)}</span>
                  {canWithdraw(a.stage) && (
                    <Button size="sm" variant="ghost" className="text-slate-600" onClick={() => withdraw(a.id)} disabled={appBusy === a.id}>
                      Withdraw
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Clubs near you that can pay more — the magnet */}
      {(oppsBusy || clubOpps.length > 0) && (
        <Card className="mt-8 bg-white">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <TrendingUp className="h-4 w-4 text-teal-600" /> Clubs near you that can pay more
              {oppsBusy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500 mb-3">
              Clubs within ~150 mi whose size supports paying above your {compNum ? usd(compNum) : 'current comp'} for a {DEPTS.find((d) => d.key === dept)?.label || 'director'}. Flip on <strong>Open to work</strong> and we’ll quietly put you in front of them when they hire.
            </p>
            {clubOpps.length === 0 && !oppsBusy ? (
              <p className="text-sm text-slate-500">No nearby clubs show clear upside over your current comp — you’re well paid for your market.</p>
            ) : (
              <div className="divide-y">
                {clubOpps.map((c, i) => (
                  <div key={`${c.club}-${i}`} className="py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">
                        {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="hover:underline">{c.club}</a> : c.club}
                        <span className="text-slate-600 font-normal"> · {c.state}</span>
                      </div>
                      <div className="text-xs text-slate-500 flex flex-wrap gap-x-2">
                        {c.distanceMiles != null && <span><MapPin className="h-3 w-3 inline" /> {c.distanceMiles} mi</span>}
                        <span>{usd(c.revenue)} club</span>
                        <span>typically pays ~{usd(c.sizeExpected)}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] font-medium rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">
                      +{usd(c.upside)} upside
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Matches / interested clubs */}
      <h2 className="text-xl font-semibold text-white mt-10 mb-3">Clubs interested in you</h2>
      {matches.length === 0 ? (
        <p className="text-slate-400 text-sm">No matches yet. When a club posts an opening that fits, it shows up here.</p>
      ) : (
        <div className="space-y-3">
          {matches.map((m) => (
            <Card key={m.id} className="bg-white">
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

      {/* Delete */}
      {hasProfile && (
        <div className="mt-12 rounded-xl border border-red-400/30 bg-red-500/5 p-4">
          <div className="font-semibold text-white flex items-center gap-2"><Trash2 className="h-4 w-4 text-red-300" /> Delete my candidate profile and résumé</div>
          <p className="text-sm text-slate-300 mt-1">
            Erases your profile details and every résumé file you uploaded, withdraws your open applications and interests, and
            stops all matching. If a club already hired you through us, we keep the placement record for billing.{' '}
            <Link href={PRIVACY_PATH} className="text-teal-400 underline">Details</Link>
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" variant="outline" className="border-red-400/50 text-red-200 hover:bg-red-500/10" onClick={deleteProfile} disabled={deleting}>
              {deleting ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Deleting…</> : 'Delete my candidate profile and résumé'}
            </Button>
            {deleteMsg && hasProfile && <span className="text-sm text-red-200">{deleteMsg}</span>}
          </div>
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
      <Label className="text-xs text-slate-300 mb-1 block">{label}</Label>
      {children}
    </div>
  );
}

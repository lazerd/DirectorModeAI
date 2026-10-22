'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, MapPin, CalendarClock, CheckCircle2, ExternalLink, ShieldCheck, Globe } from 'lucide-react';
import { sourceLabel } from '@/lib/connect/scout/labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { STAGE_LABEL, isStage } from '@/lib/connect/placement';

type Job = {
  id: string; club_name: string | null; title: string | null; dept: string;
  comp_min: number | null; comp_max: number | null; city: string | null; state: string | null; zip: string | null;
  deadline: string | null; description: string | null; requirements: string | null; job_url: string | null; created_at: string;
};
type Me = {
  signedIn: boolean; hasProfile: boolean; hasResume: boolean;
  application: { id: string; stage: string; updated_at: string } | null;
  interest?: { status: string; consent_at: string } | null;
};
// A job the Scout found on a public board (route id "s-<uuid>").
type SourcedJob = {
  kind: 'sourced'; id: string; sourced_id: string; source: string; source_url: string;
  club_name: string | null; title: string | null; dept: string; role_level: string | null;
  city: string | null; state: string | null; comp_min: number | null; comp_max: number | null;
  comp_text: string | null; est_comp: number | null; summary: string | null; requirements: string | null;
  apply_url: string | null; posted_at: string | null; deadline: string | null;
};

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [sourced, setSourced] = useState<SourcedJob | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [cover, setCover] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const res = await fetch(`/api/connect/jobs/${id}`);
    if (!res.ok) { setNotFound(true); setLoading(false); return; }
    const data = await res.json();
    if (data.job?.kind === 'sourced') setSourced(data.job);
    else setJob(data.job);
    setMe(data.me);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function apply() {
    setMsg('');
    if (!consent) { setMsg('Please check the box to authorize sending your application.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/connect/jobs/${id}/apply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_note: cover, consent: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(data.error || 'Could not submit your application.');
      else if (data.message) setMsg(data.message);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-300"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;
  }
  if (sourced && me) return <SourcedJobView job={sourced} me={me} reload={load} />;
  if (notFound || !job) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-slate-200 font-medium">This job is closed or no longer listed.</p>
        <Link href="/connect/jobs" className="text-teal-400 underline text-sm">See open jobs</Link>
      </div>
    );
  }

  const club = job.club_name || 'this club';
  const band = job.comp_max ? (job.comp_min ? `${usd(job.comp_min)}–${usd(job.comp_max)}` : `Up to ${usd(job.comp_max)}`) : null;
  const place = [job.city, job.state].filter(Boolean).join(', ');
  const stage = me?.application?.stage;
  const applied = !!stage && stage !== 'invited';

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/connect/jobs" className="text-sm text-teal-400 underline">← All jobs</Link>

      <div className="mt-3 mb-6">
        <div className="text-slate-300">{job.club_name || 'A private club'}</div>
        <h1 className="text-3xl font-bold tracking-tight text-white">{job.title || job.dept}</h1>
        <div className="mt-2 text-sm text-slate-300 flex flex-wrap gap-x-4 gap-y-1">
          {band && <span className="font-medium text-emerald-300">{band}</span>}
          {place && <span><MapPin className="h-3.5 w-3.5 inline" /> {place}</span>}
          {job.deadline && <span><CalendarClock className="h-3.5 w-3.5 inline" /> Apply by {fmtDate(job.deadline)}</span>}
        </div>
      </div>

      <Card className="bg-white mb-6">
        <CardContent className="pt-6 space-y-5">
          {job.description && (
            <section>
              <h2 className="font-semibold text-slate-900 mb-1">About the role</h2>
              <p className="text-sm text-slate-700 whitespace-pre-line">{job.description}</p>
            </section>
          )}
          {job.requirements && (
            <section>
              <h2 className="font-semibold text-slate-900 mb-1">What they&apos;re looking for</h2>
              <p className="text-sm text-slate-700 whitespace-pre-line">{job.requirements}</p>
            </section>
          )}
          {!job.description && !job.requirements && (
            <p className="text-sm text-slate-500">The club hasn&apos;t added a full description yet.</p>
          )}
          {job.job_url && /^https?:\/\//i.test(job.job_url) && (
            <a href={job.job_url} target="_blank" rel="noreferrer noopener" className="text-sm text-teal-700 underline inline-flex items-center gap-1">
              Full posting <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader><CardTitle className="text-base text-slate-900">Apply</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {applied ? (
            <div className="text-sm text-slate-700">
              <div className="flex items-center gap-2 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" /> You applied. Status: {isStage(stage) ? STAGE_LABEL[stage] : stage}
              </div>
              <p className="mt-1">Track it on <Link href="/connect/candidate" className="text-teal-700 underline">your profile</Link>.</p>
            </div>
          ) : !me?.signedIn ? (
            <div className="text-sm text-slate-700">
              <p className="mb-3">Sign in or create a free account to apply.</p>
              <Link href={`/login?redirect=${encodeURIComponent(`/connect/jobs/${job.id}`)}`}>
                <Button>Sign in to apply</Button>
              </Link>
            </div>
          ) : !me.hasProfile || !me.hasResume ? (
            <div className="text-sm text-slate-700">
              <p className="mb-3">
                {!me.hasProfile
                  ? 'Set up your candidate profile and upload your résumé first. It takes about two minutes.'
                  : 'Upload your résumé on your candidate profile, then come back to apply.'}
              </p>
              <Link href="/connect/candidate"><Button>{!me.hasProfile ? 'Create your profile' : 'Upload résumé'}</Button></Link>
            </div>
          ) : (
            <>
              {stage === 'invited' && (
                <p className="text-sm text-teal-800 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                  {club === 'this club' ? 'The club' : club} invited you to apply. They haven&apos;t seen your details yet.
                </p>
              )}
              <div>
                <label className="text-sm font-medium text-slate-800 block mb-1" htmlFor="cover">Note to the club (optional)</label>
                <Textarea
                  id="cover" value={cover} onChange={(e) => setCover(e.target.value)} rows={5} maxLength={4000}
                  placeholder="Why this club and this role…" style={{ color: '#0f172a' }}
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>I authorize ClubMode to send my application and résumé to {club} for this role.</span>
              </label>
              <div className="flex items-center gap-3">
                <Button onClick={apply} disabled={busy || !consent}>
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Sending…</> : 'Apply'}
                </Button>
                <span className="text-xs text-slate-500 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Free. Only {club} sees your details.</span>
              </div>
            </>
          )}
          {msg && <p className="text-sm text-slate-700">{msg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

const isHttp = (u: string | null | undefined): u is string => !!u && /^https?:\/\//i.test(u);

function SourcedJobView({ job, me, reload }: { job: SourcedJob; me: Me; reload: () => Promise<void> }) {
  const [note, setNote] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const club = job.club_name || 'this club';
  const board = sourceLabel(job.source);
  const band = job.comp_max
    ? (job.comp_min ? `${usd(job.comp_min)}–${usd(job.comp_max)}` : `Up to ${usd(job.comp_max)}`)
    : job.comp_min ? `${usd(job.comp_min)}+` : null;
  const place = [job.city, job.state].filter(Boolean).join(', ');
  const interested = !!me.interest && me.interest.status !== 'withdrawn';
  const applyLink = isHttp(job.apply_url) ? job.apply_url : isHttp(job.source_url) ? job.source_url : null;
  const here = `/connect/jobs/${job.id}`;

  async function raiseHand() {
    setMsg('');
    if (!consent) { setMsg(`Please check the box so we can present your profile to ${club}.`); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/connect/sourced-jobs/${job.sourced_id}/interest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true, note }),
      });
      const data = await res.json().catch(() => ({}));
      setMsg(res.ok ? data.message || 'Saved.' : data.error || 'Could not save that.');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    setBusy(true);
    try {
      await fetch(`/api/connect/sourced-jobs/${job.sourced_id}/interest`, { method: 'DELETE' });
      setMsg('Withdrawn. We won’t present you for this role.');
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <Link href="/connect/jobs" className="text-sm text-teal-400 underline">← All jobs</Link>

      <div className="mt-3 mb-6">
        <div className="text-slate-300">{job.club_name || 'A private club'}</div>
        <h1 className="text-3xl font-bold tracking-tight text-white">{job.title || job.dept}</h1>
        <div className="mt-2 text-sm text-slate-300 flex flex-wrap gap-x-4 gap-y-1">
          {band ? <span className="font-medium text-emerald-300">{band}</span>
            : job.comp_text ? <span className="font-medium text-emerald-300">{job.comp_text}</span> : null}
          {place && <span><MapPin className="h-3.5 w-3.5 inline" /> {place}</span>}
          {job.deadline && <span><CalendarClock className="h-3.5 w-3.5 inline" /> Apply by {fmtDate(job.deadline)}</span>}
        </div>
        <div className="mt-2 text-xs text-slate-400 flex items-center gap-1">
          <Globe className="h-3.5 w-3.5" /> Found on {board} · apply on the club&apos;s posting
        </div>
      </div>

      <Card className="bg-white mb-6">
        <CardContent className="pt-6 space-y-5">
          {job.summary && (
            <section>
              <h2 className="font-semibold text-slate-900 mb-1">About the role</h2>
              <p className="text-sm text-slate-700 whitespace-pre-line">{job.summary}</p>
            </section>
          )}
          {job.requirements && (
            <section>
              <h2 className="font-semibold text-slate-900 mb-1">What they&apos;re looking for</h2>
              <p className="text-sm text-slate-700 whitespace-pre-line">{job.requirements}</p>
            </section>
          )}
          {!band && !job.comp_text && job.est_comp && (
            <p className="text-sm text-slate-600">
              Pay isn&apos;t posted. Comparable roles at clubs of similar size pay about <strong>{usd(job.est_comp)}</strong> in
              total comp, based on public Form 990 filings.
            </p>
          )}
          <p className="text-xs text-slate-500">This is our summary of a public posting. Read the full posting before applying.</p>
          {applyLink && (
            <a href={applyLink} target="_blank" rel="noreferrer noopener" className="text-sm text-teal-700 underline inline-flex items-center gap-1">
              Full posting and how to apply <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader><CardTitle className="text-base text-slate-900">I&apos;m interested. Present me to this club.</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            {club === 'this club' ? 'This club' : club} hasn&apos;t hired through ClubMode yet. Tell us you&apos;re interested and
            we&apos;ll put your profile in front of them. It&apos;s free, and you can still apply on their posting yourself.
          </p>
          {interested ? (
            <div className="text-sm text-slate-700">
              <div className="flex items-center gap-2 font-medium text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {me.interest!.status === 'presented' ? `We presented you to ${club}.` : 'You’re on our list for this role.'}
              </div>
              <p className="mt-1">
                We&apos;ll let you know when there&apos;s news. Your profile: <Link href="/connect/candidate" className="text-teal-700 underline">manage it here</Link>.
              </p>
              {me.interest!.status !== 'presented' && (
                <button className="mt-2 text-xs text-slate-500 underline" onClick={withdraw} disabled={busy}>Withdraw my interest</button>
              )}
            </div>
          ) : !me.signedIn ? (
            <Link href={`/login?redirect=${encodeURIComponent(here)}`}><Button>Sign in to raise your hand</Button></Link>
          ) : !me.hasProfile || !me.hasResume ? (
            <div className="text-sm text-slate-700">
              <p className="mb-3">
                {!me.hasProfile
                  ? 'Set up your candidate profile and upload your résumé first. It takes about two minutes.'
                  : 'Upload your résumé on your candidate profile, then come back.'}
              </p>
              <Link href="/connect/candidate"><Button>{!me.hasProfile ? 'Create your profile' : 'Upload résumé'}</Button></Link>
            </div>
          ) : (
            <>
              <div>
                <label className="text-sm font-medium text-slate-800 block mb-1" htmlFor="note">Anything we should tell the club? (optional)</label>
                <Textarea
                  id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000}
                  placeholder="Why this club, when you could start…" style={{ color: '#0f172a' }}
                />
              </div>
              <label className="flex items-start gap-2 text-sm text-slate-800">
                <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span>OK to present my profile to {club} for this role.</span>
              </label>
              <div className="flex items-center gap-3">
                <Button onClick={raiseHand} disabled={busy || !consent}>
                  {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Saving…</> : 'I’m interested'}
                </Button>
                <span className="text-xs text-slate-500 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Free. Only {club} sees your details.</span>
              </div>
            </>
          )}
          {msg && <p className="text-sm text-slate-700">{msg}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

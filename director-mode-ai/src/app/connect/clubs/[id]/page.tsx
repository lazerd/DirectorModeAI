'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, FileText, Mail, Phone, Linkedin, ChevronDown, ChevronUp, Sparkles, Send } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  CLUB_VISIBLE_STAGES,
  PLACEMENT_FEE_USD,
  STAGES,
  STAGE_LABEL,
  clubCanMove,
  type Stage,
} from '@/lib/connect/placement';

type Fit = { summary?: string; strengths?: string[]; gaps?: string[]; questions?: string[] };
type Application = {
  id: string;
  stage: Stage;
  source: string;
  cover_note: string | null;
  introduced_at: string | null;
  ai_fit_score: number | null;
  ai_fit: Fit | null;
  club_notes: string | null;
  start_date: string | null;
  resume_url: string | null;
  resume_filename: string | null;
  placement: { fee_cents: number; start_date: string | null; guarantee_until: string | null; status: string } | null;
  candidate: {
    full_name: string | null; email: string | null; phone: string | null; headline: string | null;
    years_experience: number | null; certifications: string | null; linkedin_url: string | null; experience_summary: string | null;
  };
};
type Opening = { id: string; club_name: string | null; title: string | null; dept: string; status: string; terms_accepted_at: string | null; city: string | null; state: string | null };

const ORDER: Stage[] = ['applied', 'screening', 'interviewing', 'offer', 'hired', 'declined', 'withdrawn'];
const STAGE_TONE: Record<Stage, string> = {
  invited: 'bg-slate-100 text-slate-700',
  applied: 'bg-sky-100 text-sky-800',
  screening: 'bg-indigo-100 text-indigo-800',
  interviewing: 'bg-violet-100 text-violet-800',
  offer: 'bg-amber-100 text-amber-800',
  hired: 'bg-emerald-100 text-emerald-800',
  declined: 'bg-slate-100 text-slate-600',
  withdrawn: 'bg-slate-100 text-slate-600',
};
const scoreTone = (n: number) => (n >= 75 ? 'bg-emerald-600' : n >= 50 ? 'bg-amber-500' : 'bg-slate-500');
const fmtDate = (ymd: string) =>
  new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function PipelinePage() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState<Opening | null>(null);
  const [apps, setApps] = useState<Application[]>([]);
  const [invited, setInvited] = useState(0);
  const [inviteMsg, setInviteMsg] = useState('');
  const [inviting, setInviting] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/connect/openings/${id}/pipeline`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      setOpening(data.opening);
      setApps(data.applications || []);
      setInvited(data.invited || 0);
      setError('');
    } else {
      setError(res.status === 404 ? 'Opening not found.' : 'Could not load the pipeline.');
    }
    setLoading(false);
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function invite() {
    setInviting(true);
    setInviteMsg('');
    const res = await fetch(`/api/connect/openings/${id}/invite`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    setInviteMsg(!res.ok ? data.error || 'Could not send invites.'
      : data.invited > 0 ? `Invited ${data.invited} more matching director${data.invited === 1 ? '' : 's'}.`
      : 'No new matches to invite right now.');
    setInviting(false);
    await load();
  }

  if (loading) return <div className="max-w-5xl mx-auto px-4 py-16 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;
  if (error || !opening) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16">
        <Link href="/connect/clubs" className="text-sm text-teal-400 underline">← Your openings</Link>
        <p className="text-slate-300 mt-4">{error || 'Opening not found.'}</p>
      </div>
    );
  }

  const role = opening.title || opening.dept;
  const grouped = ORDER.map((s) => ({ stage: s, items: apps.filter((a) => a.stage === s) })).filter((g) => g.items.length > 0);

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      <Link href="/connect/clubs" className="text-sm text-teal-400 underline">← Your openings</Link>
      <div className="mt-2 mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">{role}</h1>
          <p className="text-slate-300">
            {[opening.club_name, [opening.city, opening.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
            {' · '}<span className="capitalize">{opening.status}</span>
          </p>
        </div>
        {opening.status === 'open' && opening.terms_accepted_at && (
          <Button onClick={invite} disabled={inviting}>
            {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />} Invite top matches
          </Button>
        )}
      </div>

      <div className="mb-6 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300">
        {invited > 0
          ? <><strong className="text-white">{invited}</strong> candidate{invited === 1 ? '' : 's'} invited and haven’t applied yet. You’ll see them here once they apply.</>
          : 'No outstanding invitations.'}
        {inviteMsg && <span className="ml-2 text-teal-300">{inviteMsg}</span>}
      </div>

      {grouped.length === 0 ? (
        <p className="text-slate-400">No applications yet. Invite your top matches, and anyone who applies to your opening shows up here with an AI fit read.</p>
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => (
            <section key={g.stage}>
              <h2 className="text-lg font-semibold text-white mb-3">
                {STAGE_LABEL[g.stage]} <span className="text-slate-400 font-normal">({g.items.length})</span>
              </h2>
              <div className="space-y-3">
                {g.items.map((a) => <ApplicantCard key={a.id} app={a} onChanged={load} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ApplicantCard({ app, onChanged }: { app: Application; onChanged: () => Promise<void> }) {
  const c = app.candidate;
  const name = c.full_name || 'Candidate';
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(app.club_notes || '');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesMsg, setNotesMsg] = useState('');
  const [next, setNext] = useState<Stage | ''>('');
  const [startDate, setStartDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const moves = STAGES.filter((s) => CLUB_VISIBLE_STAGES.includes(s) && clubCanMove(app.stage, s));

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/connect/applications/${app.id}/stage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  }

  async function move() {
    if (!next) return;
    if (next === 'hired' && !startDate) { setErr('Enter their start date.'); return; }
    setBusy(true);
    setErr('');
    const { ok, data } = await post({ stage: next, ...(next === 'hired' ? { start_date: startDate } : {}) });
    setBusy(false);
    if (!ok) { setErr(data.error || 'Could not update.'); return; }
    setNext('');
    await onChanged();
  }

  async function saveNotes() {
    setSavingNotes(true);
    const { ok } = await post({ club_notes: notes });
    setSavingNotes(false);
    setNotesMsg(ok ? 'Saved' : 'Could not save');
    setTimeout(() => setNotesMsg(''), 2000);
  }

  const fit = app.ai_fit;
  return (
    <Card className="bg-white">
      <CardContent className="py-4 text-slate-800">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-slate-900 text-base">{name}</span>
              <span className={`text-[11px] font-medium rounded-full px-2 py-0.5 ${STAGE_TONE[app.stage]}`}>{STAGE_LABEL[app.stage]}</span>
              {app.source === 'ai_invite' && <span className="text-[11px] rounded-full px-2 py-0.5 bg-teal-50 text-teal-700">Invited by ClubMode</span>}
            </div>
            <div className="text-sm text-slate-600">
              {[c.headline, c.years_experience != null ? `${c.years_experience} yrs experience` : null].filter(Boolean).join(' · ')}
            </div>
            {c.certifications && <div className="text-xs text-slate-500 mt-0.5">Certifications: {c.certifications}</div>}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {c.email && <a href={`mailto:${c.email}`} className="text-teal-700 hover:underline"><Mail className="h-3.5 w-3.5 inline mr-1" />{c.email}</a>}
              {c.phone && <a href={`tel:${c.phone}`} className="text-teal-700 hover:underline"><Phone className="h-3.5 w-3.5 inline mr-1" />{c.phone}</a>}
              {c.linkedin_url && <a href={c.linkedin_url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline"><Linkedin className="h-3.5 w-3.5 inline mr-1" />LinkedIn</a>}
              {app.resume_url && <a href={app.resume_url} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline"><FileText className="h-3.5 w-3.5 inline mr-1" />{app.resume_filename || 'Résumé'}</a>}
            </div>
          </div>
          <div className="shrink-0 text-right">
            {app.ai_fit_score != null ? (
              <div className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-white text-sm font-semibold ${scoreTone(app.ai_fit_score)}`}>
                <Sparkles className="h-3.5 w-3.5" /> {app.ai_fit_score} fit
              </div>
            ) : (
              <div className="text-xs text-slate-400">AI fit pending</div>
            )}
          </div>
        </div>

        {fit?.summary && (
          <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3 text-sm">
            <p className="text-slate-700">{fit.summary}</p>
            {((fit.strengths?.length ?? 0) + (fit.gaps?.length ?? 0) + (fit.questions?.length ?? 0)) > 0 && (
              <button onClick={() => setOpen((o) => !o)} className="mt-2 text-xs font-medium text-teal-700 inline-flex items-center gap-1">
                {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />} {open ? 'Hide' : 'Strengths, gaps and interview questions'}
              </button>
            )}
            {open && (
              <div className="mt-2 grid sm:grid-cols-3 gap-3 text-xs">
                <FitList title="Strengths" items={fit.strengths} tone="text-emerald-700" />
                <FitList title="Gaps / unknowns" items={fit.gaps} tone="text-amber-700" />
                <FitList title="Ask in interview" items={fit.questions} tone="text-slate-700" />
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400">AI read of job-related info the candidate provided. Verify in interview; you make every decision.</p>
          </div>
        )}

        {app.cover_note && (
          <div className="mt-3 text-sm">
            <div className="text-xs font-medium text-slate-500 mb-0.5">Cover note</div>
            <p className="whitespace-pre-wrap text-slate-700">{app.cover_note}</p>
          </div>
        )}
        {c.experience_summary && (
          <details className="mt-2 text-sm">
            <summary className="text-xs font-medium text-slate-500 cursor-pointer">Experience summary</summary>
            <p className="whitespace-pre-wrap text-slate-700 mt-1">{c.experience_summary}</p>
          </details>
        )}

        {app.stage === 'hired' && (
          <div className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-900">
            Hired{app.start_date ? `, starting ${fmtDate(app.start_date)}` : ''}.
            {app.placement
              ? ` Placement fee $${(app.placement.fee_cents / 100).toLocaleString()} due on the start date${app.placement.guarantee_until ? `; replacement guarantee through ${fmtDate(app.placement.guarantee_until)}` : ''}.`
              : ' No placement fee applies to this hire.'}
          </div>
        )}

        <div className="mt-4 grid sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1">Private notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
              placeholder="Only your team sees these."
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={saveNotes} disabled={savingNotes || notes === (app.club_notes || '')}>Save notes</Button>
              {notesMsg && <span className="text-xs text-slate-500">{notesMsg}</span>}
            </div>
          </div>
          {moves.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">Move to</div>
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={next}
                  onChange={(e) => { setNext(e.target.value as Stage | ''); setErr(''); }}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900"
                >
                  <option value="">Choose a stage…</option>
                  {moves.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                </select>
                {next && next !== 'hired' && <Button size="sm" onClick={move} disabled={busy}>{busy ? 'Saving…' : 'Update'}</Button>}
              </div>
              {next === 'hired' && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <label className="block text-xs font-medium mb-1">Start date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
                  />
                  <p className="mt-2">Hiring {name} confirms the ${PLACEMENT_FEE_USD.toLocaleString()} placement fee, due on their start date.</p>
                  <Button size="sm" className="mt-2" onClick={move} disabled={busy || !startDate}>{busy ? 'Saving…' : `Confirm hire`}</Button>
                </div>
              )}
              {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function FitList({ title, items, tone }: { title: string; items?: string[]; tone: string }) {
  return (
    <div>
      <div className={`font-semibold mb-1 ${tone}`}>{title}</div>
      {items && items.length > 0 ? (
        <ul className="list-disc pl-4 space-y-0.5 text-slate-700">{items.map((s, i) => <li key={i}>{s}</li>)}</ul>
      ) : (
        <p className="text-slate-400">None noted</p>
      )}
    </div>
  );
}

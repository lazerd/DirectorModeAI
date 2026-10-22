'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Play, Radar, RefreshCw } from 'lucide-react';

type Job = {
  id: string; source: string; source_url: string; club_name: string | null; title: string | null; place: string;
  comp: string | null; est_comp: number | null; status: string; opening_id: string | null;
  evaluation: {
    target_comp: number | null; comp_source: string; ai: boolean; ideal_candidate: string; must_haves: string[]; screening_questions: string[];
    bands: { step_up: { min: number; max: number }; lateral: { min: number; max: number }; maxRadiusMiles: number | null } | null;
  } | null;
  contacts: { name: string | null; role: string | null; hasEmail: boolean; touches: number; dnc: boolean }[];
  top: { name: string; club: string | null; fit: number; reason: string; optedIn: boolean; status: string }[];
  funnel: { ranked: number; contacted: number; confirmed: number; pitched: number; claimed: boolean };
  pitchReady: boolean;
  pendingVerification: boolean;
  boardOnly?: boolean;
};
type Out = {
  id: string; kind: string; club: string | null; to_name: string | null; to_email: string | null; subject: string | null; body_html?: string | null;
  status: string; auto: boolean; touch_number: number; created_at?: string; sent_at?: string | null; updated_at?: string; error?: string | null;
};
type Data = {
  jobs: Job[]; queue: Out[]; sent: Out[]; minConfirmedForPitch: number;
  referrals?: { total: number; top: { name: string; count: number }[] };
};

const k = (n: number | null | undefined) => (n ? `$${Math.round(n / 1000)}k` : '—');
const KIND: Record<string, string> = { candidate_invite: 'Candidate invite', prospect_recruit: '990 prospect', club_pitch: 'Club pitch' };
const card = 'rounded-xl border border-white/10 bg-white/5 p-4';
const btn = 'rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50';

export default function RecruitingDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; subject: string; body_html: string; to_email: string } | null>(null);
  const [tab, setTab] = useState<'jobs' | 'queue' | 'sent'>('jobs');

  const load = useCallback(async () => {
    const r = await fetch('/api/admin/recruiting/overview', { cache: 'no-store' });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function post(url: string, body: unknown, label: string) {
    setBusy(label);
    setNote('');
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      setNote(r.ok ? summarize(d) : d.error || 'Failed');
      await load();
    } finally {
      setBusy(null);
    }
  }
  const act = (action: string, extra: Record<string, unknown> = {}) => post('/api/admin/recruiting/outreach', { action, ...extra }, `${action}:${extra.id ?? ''}`);

  if (!data) return <div className="min-h-screen bg-[#001820] p-10 text-white/70"><Loader2 className="inline h-5 w-5 animate-spin" /> Loading…</div>;

  const clubDrafts = data.queue.filter((q) => q.kind === 'club_pitch' && q.status === 'draft' && q.to_email);

  return (
    <div className="min-h-screen bg-[#001820] p-4 md:p-8 text-white">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-display">Recruiting flywheel</h1>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className={`${btn} bg-white/10 hover:bg-white/20`} disabled={!!busy} onClick={() => post('/api/admin/recruiting/run', { engine: 'scout' }, 'scout')}>
            {busy === 'scout' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : <Radar className="inline h-4 w-4" />} Run scout
          </button>
          <button className={`${btn} bg-white/10 hover:bg-white/20`} disabled={!!busy} onClick={() => post('/api/admin/recruiting/run', { engine: 'recruiter', dryRun: true }, 'dry')}>
            {busy === 'dry' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : <Play className="inline h-4 w-4" />} Recruiter (no send)
          </button>
          <button className={`${btn} bg-teal-600 hover:bg-teal-500`} disabled={!!busy} onClick={() => post('/api/admin/recruiting/run', { engine: 'recruiter' }, 'run')}>
            {busy === 'run' ? <Loader2 className="inline h-4 w-4 animate-spin" /> : <Play className="inline h-4 w-4" />} Run recruiter
          </button>
          <button className={`${btn} bg-white/10 hover:bg-white/20`} onClick={load}><RefreshCw className="inline h-4 w-4" /></button>
        </div>
      </div>
      <p className="mt-2 max-w-3xl text-sm text-white/60">
        Candidates are contacted on their own. A club is pitched only after {data.minConfirmedForPitch}+ candidates confirm interest, and every club email waits for your approval here.
      </p>
      {note && <p className="mt-2 text-sm text-amber-200">{note}</p>}
      {data.referrals && (
        <p className="mt-2 text-sm text-white/70">
          Founding network referrals: <strong className="text-white">{data.referrals.total}</strong>
          {data.referrals.top.length > 0 && (
            <> · top: {data.referrals.top.map((r) => `${r.name} (${r.count})`).join(', ')}</>
          )}
        </p>
      )}

      <div className="mt-5 flex gap-2 text-sm">
        {(['jobs', 'queue', 'sent'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`${btn} ${tab === t ? 'bg-white text-[#001820]' : 'bg-white/10'}`}>
            {t === 'jobs' ? `Jobs (${data.jobs.length})` : t === 'queue' ? `Approval queue (${data.queue.length})` : `Sent log (${data.sent.length})`}
          </button>
        ))}
      </div>

      {tab === 'jobs' && (
        <div className="mt-4 space-y-3">
          {!data.jobs.length && <p className="text-white/60">No sourced jobs yet. Run the scout.</p>}
          {data.jobs.map((j) => (
            <div key={j.id} className={card}>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <button className="text-left font-semibold hover:underline" onClick={() => setOpen(open === j.id ? null : j.id)}>
                  {j.club_name || 'Unknown club'} · {j.title || 'Role'}
                </button>
                <span className="text-sm text-white/60">{j.place}</span>
                <span className="text-sm text-white/60">{j.comp || (j.est_comp ? `est. ${k(j.est_comp)}` : 'pay not posted')}</span>
                <a href={j.source_url} target="_blank" rel="noreferrer" className="text-xs text-teal-300 underline">{j.source}</a>
                {j.boardOnly && <span className="rounded bg-white/10 px-2 text-xs text-white/70">job board only</span>}
                {j.pitchReady && !j.funnel.claimed && !j.boardOnly && <span className="rounded bg-emerald-700 px-2 text-xs">pitch-ready</span>}
                {j.status === 'claimed' && <span className="rounded bg-teal-700 px-2 text-xs">claimed</span>}
              </div>
              <Funnel f={j.funnel} />
              {j.pendingVerification && (
                <div className="mt-2 text-sm text-amber-200">
                  Claimed by an email we couldn&apos;t match to the club. Candidates are waiting.{' '}
                  <button className={`${btn} bg-amber-600`} disabled={!!busy} onClick={() => post('/api/admin/recruiting/verify-claim', { sourcedJobId: j.id }, `v:${j.id}`)}>Verify and move candidates</button>
                </div>
              )}
              {open === j.id && (
                <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
                  <div>
                    <h3 className="font-semibold text-white/80">Ideal candidate</h3>
                    {j.evaluation ? (
                      <>
                        <p className="text-white/70">
                          Target {k(j.evaluation.target_comp)} ({j.evaluation.comp_source}) · step-up {k(j.evaluation.bands?.step_up.min)}–{k(j.evaluation.bands?.step_up.max)} · lateral {k(j.evaluation.bands?.lateral.min)}–{k(j.evaluation.bands?.lateral.max)} · radius {j.evaluation.bands?.maxRadiusMiles ? `${j.evaluation.bands.maxRadiusMiles} mi` : 'national'}
                        </p>
                        {j.evaluation.ideal_candidate && <p className="mt-1 text-white/80">{j.evaluation.ideal_candidate}</p>}
                        {!!j.evaluation.must_haves?.length && <ul className="mt-1 list-disc pl-5 text-white/70">{j.evaluation.must_haves.map((m) => <li key={m}>{m}</li>)}</ul>}
                        {!!j.evaluation.screening_questions?.length && (
                          <><h4 className="mt-2 font-semibold text-white/70">Screening questions</h4><ol className="list-decimal pl-5 text-white/70">{j.evaluation.screening_questions.map((q) => <li key={q}>{q}</li>)}</ol></>
                        )}
                      </>
                    ) : <p className="text-white/50">Not evaluated yet.</p>}
                    <h3 className="mt-3 font-semibold text-white/80">Club contacts ({j.contacts.length})</h3>
                    {j.contacts.map((c, i) => (
                      <div key={i} className="text-white/70">{c.name || '—'} · {c.role} · {c.hasEmail ? 'email' : 'no email'} · {c.touches} touch{c.touches === 1 ? '' : 'es'}{c.dnc ? ' · DNC' : ''}</div>
                    ))}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white/80">Top prospects (internal only)</h3>
                    {j.top.map((p, i) => (
                      <div key={i} className="mb-1">
                        <span className="font-medium">{p.fit}</span> {p.name}{p.optedIn ? ' (opted in)' : ''} · <span className="text-white/60">{p.status}</span>
                        <div className="text-white/60">{p.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'queue' && (
        <div className="mt-4 space-y-3">
          {clubDrafts.length > 0 && (
            <button className={`${btn} bg-teal-600`} disabled={!!busy} onClick={() => { if (confirm(`Approve and send ${clubDrafts.length} club pitch(es)?`)) act('approve_all_club_pitches'); }}>
              Approve all club pitches ({clubDrafts.length})
            </button>
          )}
          {!data.queue.length && <p className="text-white/60">Nothing waiting.</p>}
          {data.queue.map((q) => (
            <div key={q.id} className={card}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="rounded bg-white/10 px-2">{KIND[q.kind] || q.kind}</span>
                {q.kind === 'club_pitch' && <span className="text-white/60">touch {q.touch_number}</span>}
                {q.auto && <span className="rounded bg-emerald-800 px-2 text-xs">auto (opted in)</span>}
                <span className="font-medium">{q.club || ''}</span>
                <span className="text-white/70">→ {q.to_name || '—'} {q.to_email ? `<${q.to_email}>` : <em className="text-amber-200">needs email</em>}</span>
                <span className="ml-auto text-white/50">{q.status}</span>
              </div>
              <div className="mt-1 font-medium">{q.subject}</div>
              {edit?.id === q.id ? (
                <div className="mt-2 space-y-2">
                  <input className="w-full rounded bg-white p-2 text-sm text-slate-900" value={edit.to_email} placeholder="Email (only a real, known address)" onChange={(e) => setEdit({ ...edit, to_email: e.target.value })} />
                  <input className="w-full rounded bg-white p-2 text-sm text-slate-900" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
                  <textarea className="h-56 w-full rounded bg-white p-2 font-mono text-xs text-slate-900" value={edit.body_html} onChange={(e) => setEdit({ ...edit, body_html: e.target.value })} />
                  <div className="flex gap-2">
                    <button className={`${btn} bg-teal-600`} onClick={async () => { await act('edit', edit); setEdit(null); }}>Save</button>
                    <button className={`${btn} bg-white/10`} onClick={() => setEdit(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 rounded bg-white p-3 text-sm text-slate-800" dangerouslySetInnerHTML={{ __html: q.body_html || '' }} />
              )}
              <div className="mt-2 flex gap-2">
                <button className={`${btn} bg-teal-600`} disabled={!!busy || !q.to_email || q.status !== 'draft'} onClick={() => act('approve', { id: q.id })}>Approve &amp; send</button>
                <button className={`${btn} bg-white/10`} onClick={() => setEdit({ id: q.id, subject: q.subject || '', body_html: q.body_html || '', to_email: q.to_email || '' })}>Edit</button>
                <button className={`${btn} bg-white/10`} disabled={!!busy} onClick={() => act('skip', { id: q.id })}>Skip</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'sent' && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-white/50"><tr><th className="p-2">When</th><th>Kind</th><th>Club</th><th>To</th><th>Subject</th><th>Status</th><th /></tr></thead>
            <tbody>
              {data.sent.map((s) => (
                <tr key={s.id} className="border-t border-white/10">
                  <td className="p-2 text-white/60">{new Date(s.sent_at || s.updated_at || '').toLocaleString()}</td>
                  <td>{KIND[s.kind] || s.kind}{s.kind === 'club_pitch' ? ` #${s.touch_number}` : ''}</td>
                  <td>{s.club || ''}</td>
                  <td className="text-white/70">{s.to_name} {s.to_email ? `<${s.to_email}>` : ''}</td>
                  <td>{s.subject}</td>
                  <td className={s.status === 'failed' ? 'text-red-300' : 'text-white/70'}>{s.status}{s.error ? ` (${s.error})` : ''}</td>
                  <td>{s.kind === 'club_pitch' && s.status === 'sent' && <button className={`${btn} bg-white/10`} onClick={() => act('replied', { id: s.id })}>They replied</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Funnel({ f }: { f: Job['funnel'] }) {
  const steps: [string, string | number][] = [
    ['Ranked', f.ranked],
    ['Contacted', f.contacted],
    ['Confirmed interested', f.confirmed],
    ['Club pitched', f.pitched],
    ['Claimed', f.claimed ? 'yes' : 'no'],
  ];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
      {steps.map(([l, v], i) => (
        <span key={l} className="flex items-center gap-1">
          <span className="rounded bg-white/10 px-2 py-0.5">{l} <strong>{v}</strong></span>
          {i < steps.length - 1 && <span className="text-white/30">→</span>}
        </span>
      ))}
    </div>
  );
}

function summarize(d: Record<string, any>): string {
  if (d.recruiter) {
    const r = d.recruiter;
    return `Evaluated ${r.evaluated}; ranked ${r.ranked?.targets ?? 0} targets; drafted ${r.drafted?.candidate_invite ?? 0} invites, ${r.drafted?.prospect_recruit ?? 0} prospect notes, ${r.drafted?.club_pitch ?? 0} club pitches${r.sent ? `; sent ${r.sent.sent}, failed ${r.sent.failed}` : ' (no send)'}.`;
  }
  if (d.scout) return `Scout: ${JSON.stringify(d.scout).slice(0, 200)}`;
  if (d.approved != null) return `Approved ${d.approved}. Sending in the background.`;
  if (d.moved != null) return `Moved ${d.moved} candidate(s) into the pipeline.`;
  return 'Done.';
}

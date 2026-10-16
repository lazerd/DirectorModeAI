'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarRange, Copy, Download, Mail, Send, Users } from 'lucide-react';
import type { Campaign, League, Slot } from '@/lib/seasonBuilder/shared';
import { SLOT_SHORT, defaultLeagues, fmtDate, ntrpLabel } from '@/lib/seasonBuilder/shared';

type Group = {
  key: string; league: string; slot: Slot; ntrp: string; captains: number;
  players: { id: string; name: string; role: 'captain' | 'play' | null; needs_renewal: boolean }[];
};
type Resp = {
  id: string; name: string; email: string | null; interested: boolean; gender: string | null; ntrp: string | null;
  choices: { league: string; slot: Slot }[]; role: string | null; needs_renewal: boolean; usta_expires: string | null;
  usta_unknown: boolean; notes: string | null; source: string; vault_player_id: string | null; updated_at: string;
};
type Dash = {
  campaign: Campaign;
  links: { public: string; newsletter: string };
  counts: Record<'recipients' | 'invited' | 'sent' | 'answered' | 'interested' | 'not_interested' | 'captains' | 'needs_renewal' | 'unmatched', number>;
  groups: Group[];
  responses: Resp[];
};
type Preview = {
  subject: string; fromName: string; replyTo: string | null; html: string; total: number;
  already_sent: number; to_send: number; shared_inboxes: number; names: string[];
};

const card = 'rounded-2xl border border-white/10 bg-white/[0.04] p-5';
const btn = 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-40';
const btnPrimary = `${btn} bg-[#D3FB52] text-[#002838] hover:brightness-95`;
const btnGhost = `${btn} border border-white/15 text-white/85 hover:bg-white/10`;
const input = 'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30';

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className={`text-2xl font-bold ${tone ?? 'text-white'}`}>{value}</div>
      <div className="text-xs text-white/50">{label}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- setup form */

const SH_DEFAULTS = {
  title: 'USTA Winter Teams',
  registration_opens: '2026-11-03',
  reply_by: '2026-10-30',
  season_start: '2027-01-04',
  season_end: '2027-03-14',
};

function Settings({ initial, onSave, saving, submitLabel }: {
  initial: Partial<Campaign>; onSave: (v: Partial<Campaign>) => void; saving: boolean; submitLabel: string;
}) {
  const [v, setV] = useState<Partial<Campaign>>({
    ...initial,
    leagues: initial.leagues?.length ? initial.leagues : defaultLeagues(initial.season_end || SH_DEFAULTS.season_end),
  });
  const set = (k: keyof Campaign, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const setLeague = (i: number, patch: Partial<League>) =>
    set('leagues', (v.leagues || []).map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const date = (k: keyof Campaign, label: string) => (
    <label className="block text-xs text-white/60">
      {label}
      <input type="date" className={`${input} mt-1`} value={(v[k] as string) || ''} onChange={(e) => set(k, e.target.value || null)} />
    </label>
  );
  return (
    <div className="space-y-4">
      <label className="block text-xs text-white/60">Title (the heading on the sign-up page)
        <input className={`${input} mt-1`} value={v.title || ''} onChange={(e) => set('title', e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {date('reply_by', 'Reply by')}
        {date('registration_opens', 'USTA registration opens')}
        {date('season_start', 'Season starts')}
        {date('season_end', 'Season ends')}
      </div>
      <div>
        <div className="mb-2 text-xs text-white/60">Leagues &mdash; USTA membership must be current through the date shown</div>
        <div className="space-y-2">
          {(v.leagues || []).map((l, i) => (
            <div key={l.key} className="grid grid-cols-1 items-center gap-2 rounded-lg border border-white/10 p-3 md:grid-cols-[1.4fr_1fr_1.4fr_auto]">
              <input className={input} value={l.label} onChange={(e) => setLeague(i, { label: e.target.value })} />
              <span className="text-xs text-white/50">{l.gender === 'mixed' ? 'Mixed' : l.gender === 'female' ? 'Women' : 'Men'} · {l.min_age}+</span>
              <div className="flex flex-wrap gap-3 text-xs text-white/75">
                {(['day', 'nights_weekends'] as Slot[]).map((s) => (
                  <label key={s} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={l.slots.includes(s)}
                      onChange={(e) => {
                        const slots = e.target.checked ? [...l.slots, s] : l.slots.filter((x) => x !== s);
                        if (slots.length) setLeague(i, { slots: (['day', 'nights_weekends'] as Slot[]).filter((x) => slots.includes(x)) });
                      }}
                    />
                    {SLOT_SHORT[s]}
                  </label>
                ))}
              </div>
              <input type="date" className={input} value={l.valid_through} onChange={(e) => setLeague(i, { valid_through: e.target.value })} title="USTA membership must be valid through" />
            </div>
          ))}
        </div>
      </div>
      <label className="block text-xs text-white/60">Extra line for the email (optional)
        <textarea className={`${input} mt-1`} rows={2} value={v.intro || ''} onChange={(e) => set('intro', e.target.value)}
          placeholder="e.g. New this year: a daytime 3.0 team if we get enough players." />
      </label>
      <label className="block text-xs text-white/60">Sign-off
        <input className={`${input} mt-1`} value={v.sign_off || ''} onChange={(e) => set('sign_off', e.target.value)} placeholder="Darrin Cohen, Director of Tennis" />
      </label>
      <button className={btnPrimary} disabled={saving} onClick={() => onSave(v)}>{saving ? 'Saving…' : submitLabel}</button>
    </div>
  );
}

/* ---------------------------------------------------------------- main */

export default function SeasonBuilder() {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [id, setId] = useState<string | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState<{ sent: number; failed: number; remaining: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [teamMsg, setTeamMsg] = useState<Record<string, string>>({});

  const loadList = useCallback(async () => {
    const r = await fetch('/api/season-builder');
    const j = await r.json();
    if (!r.ok) return setErr(j.error || 'Could not load');
    setCampaigns(j.campaigns);
    if (j.campaigns.length) setId((cur) => cur ?? j.campaigns[0].id);
  }, []);
  const loadDash = useCallback(async () => {
    if (!id) return;
    const r = await fetch(`/api/season-builder/${id}`);
    const j = await r.json();
    if (!r.ok) return setErr(j.error || 'Could not load');
    setDash(j);
  }, [id]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { loadDash(); }, [loadDash]);
  // The head count is live: answers arrive while the director watches.
  useEffect(() => {
    if (!id) return;
    const t = setInterval(loadDash, 30000);
    return () => clearInterval(t);
  }, [id, loadDash]);

  async function create(v: Partial<Campaign>) {
    setSaving(true); setErr(null);
    const r = await fetch('/api/season-builder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
    const j = await r.json(); setSaving(false);
    if (!r.ok) return setErr(j.error);
    setId(j.campaign.id); loadList();
  }
  async function save(v: Partial<Campaign>) {
    setSaving(true); setErr(null);
    const r = await fetch(`/api/season-builder/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
    const j = await r.json(); setSaving(false);
    if (!r.ok) return setErr(j.error);
    setEditing(false); setPreview(null); loadDash();
  }
  async function send(mode: 'preview' | 'test') {
    setErr(null); setNote(null);
    const r = await fetch(`/api/season-builder/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error);
    if (mode === 'preview') setPreview(j);
    else setNote(j.ok ? `Test sent to ${j.to}. The button in it opens the public sign-up form.` : `Test didn’t send (${j.error}).`);
  }
  async function sendAll() {
    setConfirming(false); setErr(null);
    let total = { sent: 0, failed: 0, remaining: 1 };
    setSending(total);
    while (total.remaining > 0) {
      const r = await fetch(`/api/season-builder/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'live' }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || 'Send stopped.'); break; }
      total = { sent: total.sent + j.sent, failed: total.failed + j.failed, remaining: j.remaining };
      setSending({ ...total });
      if (!j.sent && !j.failed) break;
    }
    setPreview(null); loadDash();
  }
  async function makeTeam(g: Group) {
    setTeamMsg((m) => ({ ...m, [g.key]: 'Creating…' }));
    const r = await fetch(`/api/season-builder/${id}/team`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ league: g.league, slot: g.slot, ntrp: g.ntrp }),
    });
    const j = await r.json();
    setTeamMsg((m) => ({ ...m, [g.key]: r.ok ? `__${j.url}__${j.added}` : j.error }));
  }
  const copy = (t: string, what: string) => navigator.clipboard.writeText(t).then(() => setNote(`${what} copied.`));

  if (campaigns === null) return <div className="p-8 text-white/50">Loading…</div>;

  if (!campaigns.length) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-6 text-white">
        <Header />
        <div className={card}>
          <h2 className="mb-1 text-lg font-semibold">Start a season</h2>
          <p className="mb-5 text-sm text-white/55">Set the dates and leagues. Nothing is sent until you preview it and press send.</p>
          {err && <p className="mb-3 text-sm text-rose-300">{err}</p>}
          <Settings initial={SH_DEFAULTS} onSave={create} saving={saving} submitLabel="Create" />
        </div>
      </div>
    );
  }

  if (!dash) return <div className="p-8 text-white/50">Loading…</div>;
  const c = dash.campaign;
  const k = dash.counts;
  const leagueLabel = (key: string) => c.leagues.find((l) => l.key === key)?.label ?? key;
  const renewals = dash.responses.filter((r) => r.interested && r.needs_renewal);
  const unmatched = dash.responses.filter((r) => !r.vault_player_id);
  const captains = dash.responses.filter((r) => r.interested && r.role === 'captain');

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 text-white">
      <Header />

      {/* ------- campaign */}
      <div className={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold">{c.title}</h2>
              <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === 'draft' ? 'bg-white/10 text-white/60' : c.status === 'sent' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-amber-400/15 text-amber-300'}`}>
                {c.status === 'draft' ? 'Not sent yet' : c.status === 'sent' ? `Sent ${c.sent_at ? fmtDate(c.sent_at.slice(0, 10)) : ''}` : 'Closed'}
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-white/55">
              <CalendarRange className="h-4 w-4" />
              Reply by {fmtDate(c.reply_by)} · registration opens {fmtDate(c.registration_opens)} · season {fmtDate(c.season_start, { month: 'short', day: 'numeric' })}–{fmtDate(c.season_end, { month: 'short', day: 'numeric' })}
            </p>
            <p className="mt-1 text-sm text-white/55">{c.leagues.map((l) => `${l.label} (${l.slots.map((s) => SLOT_SHORT[s]).join(' / ')})`).join(' · ')}</p>
          </div>
          <div className="flex gap-2">
            {campaigns.length > 1 && (
              <select className={`${input} w-auto`} value={id ?? ''} onChange={(e) => { setDash(null); setId(e.target.value); }}>
                {campaigns.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </select>
            )}
            <button className={btnGhost} onClick={() => setEditing((e) => !e)}>{editing ? 'Close' : 'Edit'}</button>
            {c.status !== 'closed'
              ? <button className={btnGhost} onClick={() => save({ status: 'closed' })}>Close sign-ups</button>
              : <button className={btnGhost} onClick={() => save({ status: c.sent_at ? 'sent' : 'draft' })}>Reopen</button>}
          </div>
        </div>
        {editing && <div className="mt-5 border-t border-white/10 pt-5"><Settings initial={c} onSave={save} saving={saving} submitLabel="Save" /></div>}
      </div>

      {err && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">{err}</div>}
      {note && <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-200">{note}</div>}

      {/* ------- head count */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label={`emailed of ${k.recipients} members`} value={k.sent} />
        <Stat label="answered" value={k.answered} />
        <Stat label="want to play" value={k.interested} tone="text-emerald-300" />
        <Stat label="not this season" value={k.not_interested} tone="text-white/60" />
        <Stat label="will captain" value={k.captains} tone="text-sky-300" />
        <Stat label="must renew USTA" value={k.needs_renewal} tone={k.needs_renewal ? 'text-amber-300' : 'text-white'} />
      </div>

      <div className={card}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold"><Users className="h-5 w-5" /> Head count by team</h3>
          <a className={btnGhost} href={`/api/season-builder/${id}/export`}><Download className="h-4 w-4" /> Export CSV</a>
        </div>
        {!dash.groups.length ? (
          <p className="text-sm text-white/50">No answers yet. Groups appear here as people sign up.</p>
        ) : (
          c.leagues.map((l) => {
            const gs = dash.groups.filter((g) => g.league === l.key);
            if (!gs.length) return null;
            return (
              <div key={l.key} className="mb-5">
                <div className="mb-2 text-sm font-semibold text-white/80">{l.label}</div>
                <div className="overflow-hidden rounded-xl border border-white/10">
                  {gs.map((g) => {
                    const msg = teamMsg[g.key];
                    const made = msg?.startsWith('__') ? msg.split('__') : null;
                    return (
                      <div key={g.key} className="border-b border-white/5 last:border-0">
                        <button className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-white/[0.03]" onClick={() => setOpenGroup(openGroup === g.key ? null : g.key)}>
                          <span className="w-28 text-sm text-white/60">{l.slots.length > 1 ? SLOT_SHORT[g.slot] : ''}</span>
                          <span className="w-24 font-semibold">{ntrpLabel(g.ntrp)}</span>
                          <span className="w-28 text-sm"><b className="text-lg">{g.players.length}</b> {g.players.length === 1 ? 'player' : 'players'}</span>
                          <span className={`text-sm ${g.captains ? 'text-sky-300' : 'text-amber-300/80'}`}>{g.captains ? `${g.captains} captain${g.captains > 1 ? 's' : ''}` : 'no captain yet'}</span>
                          <span className="ml-auto text-xs text-white/40">{openGroup === g.key ? 'hide' : 'names'}</span>
                        </button>
                        {openGroup === g.key && (
                          <div className="space-y-3 bg-black/10 px-4 pb-4 pt-1">
                            <div className="flex flex-wrap gap-1.5">
                              {g.players.map((p) => (
                                <span key={p.id} className={`rounded-full px-2.5 py-1 text-xs ${p.role === 'captain' ? 'bg-sky-400/15 text-sky-200' : 'bg-white/10 text-white/80'}`}>
                                  {p.name}{p.role === 'captain' ? ' · captain' : ''}{p.needs_renewal ? ' · renew USTA' : ''}
                                </span>
                              ))}
                            </div>
                            {made ? (
                              <p className="text-sm text-emerald-300">Team ready ({made[3]} added). <a className="underline" href={made[2]}>Open in CaptainMode →</a></p>
                            ) : (
                              <button className={btnGhost} onClick={() => makeTeam(g)} disabled={msg === 'Creating…'}>{msg === 'Creating…' ? 'Creating…' : 'Create team in CaptainMode'}</button>
                            )}
                            {msg && !made && msg !== 'Creating…' && <p className="text-sm text-rose-300">{msg}</p>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {(captains.length > 0 || renewals.length > 0 || unmatched.length > 0) && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className={card}>
            <h4 className="mb-2 font-semibold text-sky-300">Want to captain ({captains.length})</h4>
            {captains.map((r) => <div key={r.id} className="text-sm text-white/80">{r.name} <span className="text-white/40">· {r.choices.map((ch) => `${leagueLabel(ch.league)} ${SLOT_SHORT[ch.slot]}`).join(', ')} · {ntrpLabel(r.ntrp)}</span></div>)}
          </div>
          <div className={card}>
            <h4 className="mb-2 font-semibold text-amber-300">Must renew USTA ({renewals.length})</h4>
            <p className="mb-2 text-xs text-white/45">Each was emailed the renewal link when they signed up.</p>
            {renewals.map((r) => <div key={r.id} className="text-sm text-white/80">{r.name} <span className="text-white/40">· {r.usta_unknown || !r.usta_expires ? 'not sure' : `expires ${r.usta_expires.slice(0, 7)}`}</span></div>)}
          </div>
          <div className={card}>
            <h4 className="mb-2 font-semibold text-white/80">Not matched to a member ({unmatched.length})</h4>
            <p className="mb-2 text-xs text-white/45">Signed up from the newsletter link with a name we couldn&rsquo;t find in PlayerVault. Check the spelling, or add them.</p>
            {unmatched.map((r) => <div key={r.id} className="text-sm text-white/80">{r.name} <span className="text-white/40">· {r.email}</span></div>)}
          </div>
        </div>
      )}

      {/* ------- send */}
      <div className={card}>
        <h3 className="mb-1 flex items-center gap-2 text-lg font-semibold"><Mail className="h-5 w-5" /> Email every member</h3>
        <p className="mb-4 text-sm text-white/55">
          Each adult in PlayerVault gets their own link. One email each, no reminders. Sending again later only reaches people added since.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} onClick={() => send('preview')}>Preview</button>
          <button className={btnGhost} onClick={() => send('test')}>Send me a test</button>
          {preview && preview.to_send > 0 && !confirming && !sending && (
            <button className={btnPrimary} onClick={() => setConfirming(true)}><Send className="h-4 w-4" /> Send to {preview.to_send} members</button>
          )}
          {confirming && (
            <span className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-100">
              Send to {preview?.to_send} people now?
              <button className={btnPrimary} onClick={sendAll}>Yes, send</button>
              <button className={btnGhost} onClick={() => setConfirming(false)}>Cancel</button>
            </span>
          )}
        </div>
        {sending && (
          <p className="mt-3 text-sm text-white/75">
            {sending.remaining > 0 ? 'Sending… ' : 'Done. '}{sending.sent} sent{sending.failed ? `, ${sending.failed} skipped (unsubscribed or bounced)` : ''}{sending.remaining > 0 ? `, ${sending.remaining} to go` : ''}.
          </p>
        )}
        {!preview && <p className="mt-3 text-xs text-white/40">Preview first. The send button appears after you&rsquo;ve looked at it.</p>}
        {preview && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_300px]">
            <div>
              <div className="mb-2 text-sm text-white/70">
                <div><span className="text-white/45">From:</span> {preview.fromName}{preview.replyTo ? ` (replies go to ${preview.replyTo})` : ''}</div>
                <div><span className="text-white/45">Subject:</span> {preview.subject}</div>
              </div>
              <iframe title="Email preview" srcDoc={preview.html} className="h-[560px] w-full rounded-xl border border-white/10 bg-white" />
            </div>
            <div className="text-sm text-white/70">
              <div className="mb-2"><b className="text-white">{preview.to_send}</b> will get it{preview.already_sent ? ` · ${preview.already_sent} already did` : ''}.</div>
              {preview.shared_inboxes > 0 && <p className="mb-2 text-xs text-white/45">{preview.shared_inboxes} inboxes are shared by a household; each adult there gets their own email, with their first name in the subject.</p>}
              <div className="max-h-[480px] overflow-auto rounded-lg border border-white/10 p-2 text-xs text-white/60">
                {preview.names.map((n, i) => <div key={`${n}-${i}`}>{n}</div>)}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ------- newsletter */}
      <div className={card}>
        <h3 className="mb-1 text-lg font-semibold">Newsletter &amp; Constant Contact</h3>
        <p className="mb-4 text-sm text-white/55">This link works for anyone: they type their name and email and we match them to their member record. Everything lands in the same head count.</p>
        <div className="mb-3 flex gap-2">
          <input readOnly className={input} value={dash.links.public} />
          <button className={btnGhost} onClick={() => copy(dash.links.public, 'Link')}><Copy className="h-4 w-4" /> Copy</button>
        </div>
        <textarea readOnly className={`${input} font-mono text-xs`} rows={14} value={dash.links.newsletter} />
        <button className={`${btnGhost} mt-2`} onClick={() => copy(dash.links.newsletter, 'Newsletter text')}><Copy className="h-4 w-4" /> Copy newsletter text</button>
      </div>

      {/* ------- every answer */}
      <div className={card}>
        <h3 className="mb-3 text-lg font-semibold">Every answer ({dash.responses.length})</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-white/45">
              <tr><th className="py-2 pr-3">Name</th><th className="pr-3">Playing</th><th className="pr-3">Level</th><th className="pr-3">Captain</th><th className="pr-3">USTA</th><th className="pr-3">Notes</th><th>When</th></tr>
            </thead>
            <tbody>
              {dash.responses.map((r) => (
                <tr key={r.id} className="border-t border-white/5 align-top">
                  <td className="py-2 pr-3">{r.name}{r.source === 'public' && <span className="ml-1 text-xs text-white/35">(newsletter)</span>}</td>
                  <td className="pr-3 text-white/75">{r.interested ? r.choices.map((ch) => `${leagueLabel(ch.league)} ${SLOT_SHORT[ch.slot]}`).join(', ') : <span className="text-white/40">Not this season</span>}</td>
                  <td className="pr-3">{r.interested ? ntrpLabel(r.ntrp) : ''}</td>
                  <td className="pr-3">{r.role === 'captain' ? <span className="text-sky-300">Yes</span> : ''}</td>
                  <td className={`pr-3 ${r.needs_renewal ? 'text-amber-300' : 'text-white/60'}`}>{!r.interested ? '' : r.usta_unknown || !r.usta_expires ? 'not sure' : r.usta_expires.slice(0, 7)}</td>
                  <td className="pr-3 text-white/60">{r.notes}</td>
                  <td className="whitespace-nowrap text-white/40">{fmtDate(r.updated_at.slice(0, 10), { month: 'short', day: 'numeric' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Header() {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-white/40">Members</div>
      <h1 className="text-2xl font-bold">Season Builder</h1>
      <p className="text-sm text-white/55">Find out who&rsquo;s playing which USTA league, at what level, and who will captain — before you register teams.</p>
    </div>
  );
}

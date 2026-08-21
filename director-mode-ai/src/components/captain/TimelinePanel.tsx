'use client';

/**
 * The season email timeline.
 *
 * Left of each row is when the email actually goes out — the daily cron tick,
 * not the theoretical lead time — so a captain reading this page is reading the
 * scheduler itself. Editing anything (lead time, copy, a single match's slot)
 * writes straight back to the rules the cron reads.
 */

import { useMemo, useState } from 'react';
import { Check, Mail, Pencil, Send, TriangleAlert, X } from 'lucide-react';
import type { EmailKind, KindMeta, TimelineEvent, TimelineStatus } from '@/lib/captain/timeline';

const TZ = 'America/Los_Angeles';

type Setting = {
  kind: EmailKind;
  enabled: boolean;
  leadDays: number;
  subjectOverride: string | null;
  introOverride: string | null;
  isDefault: boolean;
  meta: KindMeta;
};

const KIND_COLOR: Record<EmailKind, string> = {
  poll: '#D3FB52',
  lineup: '#7dd3fc',
  nudge: '#fbbf24',
  reminder: '#c4b5fd',
};

const STATUS_STYLE: Record<TimelineStatus, { label: string; cls: string }> = {
  sent: { label: 'Sent', cls: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20' },
  due: { label: 'Goes out today', cls: 'bg-amber-400/10 text-amber-300 border-amber-400/25' },
  scheduled: { label: 'Scheduled', cls: 'bg-white/[0.06] text-white/60 border-white/10' },
  blocked: { label: 'Needs attention', cls: 'bg-orange-500/10 text-orange-300 border-orange-400/25' },
  skipped: { label: 'Skipped', cls: 'bg-white/[0.04] text-white/35 border-white/10' },
  off: { label: 'Off', cls: 'bg-white/[0.04] text-white/35 border-white/10' },
  missed: { label: 'Never sent', cls: 'bg-red-500/10 text-red-300 border-red-400/25' },
};

const fmtDay = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: TZ }).format(
    new Date(iso),
  );
const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ }).format(new Date(iso));
const fmtMonth = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: TZ }).format(new Date(iso));
/** yyyy-mm-dd in club time, for <input type="date">. */
const dateInputValue = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TZ }).format(
    new Date(iso),
  );

export default function TimelinePanel({
  teamId,
  initialEvents,
  initialSettings,
  rosterWithEmail,
}: {
  teamId: string;
  initialEvents: TimelineEvent[];
  initialSettings: Setting[];
  rosterWithEmail: number;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [settings, setSettings] = useState(initialSettings);
  const [open, setOpen] = useState<TimelineEvent | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/captain/timeline?team_id=${teamId}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    setEvents(data.events);
    setSettings(data.settings);
  }

  const upcoming = events.filter((e) => e.status === 'due' || e.status === 'scheduled').length;
  const attention = events.filter((e) => e.status === 'blocked' || e.status === 'missed').length;

  // Month headers make a 9-match season scannable without a scrollbar hunt.
  const grouped = useMemo(() => {
    const out: { month: string; items: TimelineEvent[] }[] = [];
    for (const e of events) {
      const month = fmtMonth(e.sentAt || e.sendAt);
      if (!out.length || out[out.length - 1].month !== month) out.push({ month, items: [] });
      out[out.length - 1].items.push(e);
    }
    return out;
  }, [events]);

  return (
    <>
      {banner && (
        <div className="mt-6 rounded-xl border border-[#D3FB52]/30 bg-[#D3FB52]/10 px-4 py-3 text-sm text-[#D3FB52] flex items-start justify-between gap-3">
          <span>{banner}</span>
          <button onClick={() => setBanner(null)} className="text-[#D3FB52]/70 hover:text-[#D3FB52]">
            <X size={16} />
          </button>
        </div>
      )}

      <RulesBar
        teamId={teamId}
        settings={settings}
        onSaved={async (msg) => {
          setBanner(msg);
          await refresh();
        }}
      />

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-white/40">
        <span>{upcoming} scheduled</span>
        <span>{events.filter((e) => e.status === 'sent').length} already sent</span>
        {attention > 0 && <span className="text-orange-300">{attention} need attention</span>}
        <span>{rosterWithEmail} players with an email address</span>
      </div>

      {events.length === 0 && (
        <p className="mt-8 text-white/50">
          No matches on the schedule yet — add matches and the season timeline builds itself.
        </p>
      )}

      <div className="mt-6">
        {grouped.map((g) => (
          <div key={g.month} className="mb-8">
            <div className="text-xs uppercase tracking-wider text-white/30 font-semibold mb-3">
              {g.month}
            </div>
            <div className="relative pl-6 md:pl-8">
              <div className="absolute left-[7px] md:left-[9px] top-2 bottom-2 w-px bg-white/[0.08]" />
              <div className="space-y-2">
                {g.items.map((e) => (
                  <Row key={e.id} event={e} onOpen={() => setOpen(e)} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <EventEditor
          teamId={teamId}
          event={open}
          onClose={() => setOpen(null)}
          onChanged={async (msg) => {
            setOpen(null);
            setBanner(msg);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function Row({ event, onOpen }: { event: TimelineEvent; onOpen: () => void }) {
  const s = STATUS_STYLE[event.status];
  const when = event.sentAt || event.sendAt;
  const muted = event.status === 'skipped' || event.status === 'off';

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left relative rounded-xl border border-white/[0.07] bg-[#002838] p-4 hover:border-[#D3FB52]/30 transition-colors ${
        muted ? 'opacity-55' : ''
      }`}
    >
      <span
        className="absolute -left-[19px] md:-left-[23px] top-6 w-2.5 h-2.5 rounded-full ring-4 ring-[#001820]"
        style={{ background: KIND_COLOR[event.kind] }}
      />
      <div className="flex items-start gap-4">
        <div className="shrink-0 w-20">
          <div className="text-white text-sm font-medium">{fmtDay(when)}</div>
          <div className="text-white/35 text-xs">{fmtTime(when)}</div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[11px] uppercase tracking-wider font-semibold"
              style={{ color: KIND_COLOR[event.kind] }}
            >
              {KIND_LABEL[event.kind]}
            </span>
            {event.edited && (
              <span className="text-[10px] uppercase tracking-wider text-white/30 border border-white/10 rounded px-1.5 py-0.5">
                edited
              </span>
            )}
          </div>
          <div className={`text-white mt-1 leading-snug ${muted ? 'line-through' : ''}`}>
            {event.subject}
          </div>
          <div className="text-white/35 text-xs mt-1.5">
            to {event.audienceCount} {event.audienceCount === 1 ? 'player' : 'players'} ·{' '}
            {event.opponent ? `vs ${event.opponent}` : 'match'} {fmtDay(event.matchAt)}
          </div>
          {event.reason && event.status !== 'sent' && (
            <div className="text-orange-300/80 text-xs mt-1.5 flex items-start gap-1.5">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              {event.reason}
            </div>
          )}
        </div>

        <span className={`shrink-0 text-[11px] rounded-full border px-2.5 py-1 ${s.cls}`}>{s.label}</span>
      </div>
    </button>
  );
}

const KIND_LABEL: Record<EmailKind, string> = {
  poll: 'Availability poll',
  lineup: 'Lineup',
  nudge: 'Nudge',
  reminder: 'Day-before reminder',
};

/* ------------------------------------------------------------------ rules */

function RulesBar({
  teamId,
  settings,
  onSaved,
}: {
  teamId: string;
  settings: Setting[];
  onSaved: (msg: string) => void;
}) {
  const [editing, setEditing] = useState<EmailKind | null>(null);

  return (
    <div className="mt-7">
      <div className="text-xs uppercase tracking-wider text-white/30 font-semibold mb-3">
        Automation rules
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {settings.map((s) => (
          <RuleCard
            key={s.kind}
            teamId={teamId}
            setting={s}
            open={editing === s.kind}
            onToggleOpen={() => setEditing(editing === s.kind ? null : s.kind)}
            onSaved={onSaved}
          />
        ))}
      </div>
    </div>
  );
}

function RuleCard({
  teamId,
  setting,
  open,
  onToggleOpen,
  onSaved,
}: {
  teamId: string;
  setting: Setting;
  open: boolean;
  onToggleOpen: () => void;
  onSaved: (msg: string) => void;
}) {
  const [lead, setLead] = useState(String(setting.leadDays));
  const [subject, setSubject] = useState(setting.subjectOverride || '');
  const [intro, setIntro] = useState(setting.introOverride || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty =
    Number(lead) !== setting.leadDays ||
    subject !== (setting.subjectOverride || '') ||
    intro !== (setting.introOverride || '');

  async function save(patch: Record<string, unknown>, msg: string) {
    setBusy(true);
    setErr(null);
    const res = await fetch('/api/captain/timeline/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, kind: setting.kind, ...patch }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not save that.');
      return;
    }
    onSaved(msg);
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#002838] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium" style={{ color: KIND_COLOR[setting.kind] }}>
            {KIND_LABEL[setting.kind]}
          </div>
          <div className="text-white/40 text-xs mt-0.5">{setting.meta.blurb}</div>
        </div>
        <button
          onClick={() =>
            save({ enabled: !setting.enabled }, `${KIND_LABEL[setting.kind]} emails ${setting.enabled ? 'turned off' : 'turned on'}.`)
          }
          disabled={busy}
          className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${
            setting.enabled ? 'bg-[#D3FB52]' : 'bg-white/15'
          }`}
          aria-label={setting.enabled ? 'Turn off' : 'Turn on'}
        >
          <span
            className={`absolute top-1 w-4 h-4 rounded-full bg-[#001820] transition-all ${
              setting.enabled ? 'left-6' : 'left-1'
            }`}
          />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="number"
          min={0}
          max={120}
          step={0.5}
          value={lead}
          onChange={(e) => setLead(e.target.value)}
          style={{ color: '#fff' }}
          className="w-20 px-2.5 py-1.5 rounded-lg bg-[#001820] border border-white/10 focus:outline-none focus:border-[#D3FB52]/50"
        />
        <span className="text-white/50">days before each match</span>
      </div>

      <button
        onClick={onToggleOpen}
        className="mt-3 text-xs text-white/45 hover:text-white inline-flex items-center gap-1.5"
      >
        <Pencil size={12} />
        {open ? 'Hide wording' : 'Edit wording'}
        {(setting.subjectOverride || setting.introOverride) && (
          <span className="text-[#D3FB52]/70">· customised</span>
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <label className="block text-xs text-white/45 mb-1">Subject line</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Leave blank for the default"
              style={{ color: '#fff' }}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#001820] border border-white/10 focus:outline-none focus:border-[#D3FB52]/50"
            />
          </div>
          <div>
            <label className="block text-xs text-white/45 mb-1">Note at the top of the email</label>
            <textarea
              value={intro}
              onChange={(e) => setIntro(e.target.value)}
              rows={3}
              placeholder="Optional — appears above the match details"
              style={{ color: '#fff' }}
              className="w-full px-3 py-2 text-sm rounded-lg bg-[#001820] border border-white/10 focus:outline-none focus:border-[#D3FB52]/50"
            />
          </div>
          <p className="text-[11px] text-white/30 leading-relaxed">
            Use {'{team}'}, {'{name}'}, {'{when}'}, {'{opponent}'}, {'{home_away}'} and they get filled
            in per player. The buttons, links and unsubscribe footer are always added for you.
          </p>
        </div>
      )}

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      {dirty && (
        <button
          onClick={() =>
            save(
              { lead_days: Number(lead), subject_override: subject, intro_override: intro },
              `${KIND_LABEL[setting.kind]} updated.`,
            )
          }
          disabled={busy}
          className="mt-3 px-3.5 py-2 rounded-lg bg-[#D3FB52] text-[#001820] text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- editor */

function EventEditor({
  teamId,
  event,
  onClose,
  onChanged,
}: {
  teamId: string;
  event: TimelineEvent;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [sendDate, setSendDate] = useState(dateInputValue(event.sendAt));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string; count: number; sample_for?: string } | null>(
    null,
  );
  const [confirmSend, setConfirmSend] = useState(false);

  const alreadySent = event.status === 'sent';

  async function patch(body: Record<string, unknown>, msg: string) {
    setBusy(msg);
    setErr(null);
    const res = await fetch('/api/captain/timeline/override', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, match_id: event.matchId, kind: event.kind, ...body }),
    });
    setBusy(null);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not save that.');
      return;
    }
    onChanged(msg);
  }

  async function loadPreview() {
    setBusy('Loading preview');
    setErr(null);
    const res = await fetch('/api/captain/timeline/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, match_id: event.matchId, kind: event.kind, preview: true }),
    });
    setBusy(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error || 'Could not build that preview.');
      return;
    }
    setPreview(data);
  }

  async function sendNow() {
    setBusy('Sending');
    setErr(null);
    const res = await fetch('/api/captain/timeline/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, match_id: event.matchId, kind: event.kind }),
    });
    setBusy(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error || 'Could not send that email.');
      return;
    }
    onChanged(`Sent to ${data.sent} player${data.sent === 1 ? '' : 's'}.`);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#002838] border border-white/10 overflow-hidden"
      >
        <div className="p-5 border-b border-white/10">
          <div
            className="text-xs uppercase tracking-wider font-semibold"
            style={{ color: KIND_COLOR[event.kind] }}
          >
            {KIND_LABEL[event.kind]}
          </div>
          <h3 className="text-white text-lg font-medium mt-1.5 leading-snug">{event.subject}</h3>
          <div className="text-white/45 text-sm mt-2">
            {alreadySent ? 'Sent' : 'Goes out'} {fmtDay(event.sentAt || event.sendAt)} at{' '}
            {fmtTime(event.sentAt || event.sendAt)} · to {event.audienceCount}{' '}
            {event.audienceCount === 1 ? 'player' : 'players'}
          </div>
          {event.reason && <div className="text-orange-300/80 text-sm mt-2">{event.reason}</div>}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {preview ? (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs uppercase tracking-wider text-[#D3FB52] font-semibold">
                  Exact email {preview.sample_for ? `— ${preview.sample_for}'s copy` : ''}
                </div>
                <button onClick={() => setPreview(null)} className="text-white/40 hover:text-white text-xs">
                  hide
                </button>
              </div>
              <iframe
                title="Email preview"
                sandbox=""
                srcDoc={preview.html}
                className="w-full h-80 rounded-xl bg-white border border-white/10"
              />
            </div>
          ) : (
            <button
              onClick={loadPreview}
              disabled={!!busy}
              className="w-full py-2.5 rounded-xl border border-white/15 text-white/80 hover:text-white hover:border-white/30 text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Mail size={15} /> {busy === 'Loading preview' ? 'Loading…' : 'Show the exact email'}
            </button>
          )}

          {!alreadySent && (
            <>
              <div>
                <label className="block text-xs text-white/45 mb-1.5">Send on</label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={sendDate}
                    onChange={(e) => setSendDate(e.target.value)}
                    style={{ color: '#fff', colorScheme: 'dark' }}
                    className="px-3 py-2 text-sm rounded-lg bg-[#001820] border border-white/10 focus:outline-none focus:border-[#D3FB52]/50"
                  />
                  {dateInputValue(event.sendAt) !== sendDate && (
                    <button
                      onClick={() =>
                        // 16:00 UTC is the daily cron tick, so this lands on the
                        // chosen day rather than drifting into the one before.
                        patch({ send_at: `${sendDate}T16:00:00.000Z` }, 'Send date moved.')
                      }
                      disabled={!!busy}
                      className="px-3 py-2 rounded-lg bg-[#D3FB52] text-[#001820] text-sm font-semibold disabled:opacity-50"
                    >
                      Move it
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-white/30 mt-1.5">
                  Emails go out on the daily run, {fmtTime(event.sendAt)} club time.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() =>
                    patch(
                      { skip: event.status !== 'skipped' },
                      event.status === 'skipped' ? 'Back on the schedule.' : 'This one will be skipped.',
                    )
                  }
                  disabled={!!busy}
                  className="px-3.5 py-2 rounded-lg border border-white/15 text-white/80 hover:text-white text-sm disabled:opacity-50"
                >
                  {event.status === 'skipped' ? 'Put it back' : 'Skip this one'}
                </button>

                {event.edited && (
                  <button
                    onClick={() => patch({ reset: true }, 'Back to the team default.')}
                    disabled={!!busy}
                    className="px-3.5 py-2 rounded-lg border border-white/15 text-white/60 hover:text-white text-sm disabled:opacity-50"
                  >
                    Reset to team default
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-white/10 flex items-center justify-between gap-3">
          {err ? <p className="text-sm text-red-300 flex-1">{err}</p> : <span className="flex-1" />}
          <button
            onClick={onClose}
            disabled={!!busy}
            className="px-4 py-2.5 rounded-xl text-white/60 hover:text-white text-sm disabled:opacity-50"
          >
            Close
          </button>
          {!alreadySent &&
            (confirmSend ? (
              <button
                onClick={sendNow}
                disabled={!!busy}
                className="px-4 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Check size={15} />
                {busy === 'Sending' ? 'Sending…' : `Yes — send to ${event.audienceCount} now`}
              </button>
            ) : (
              <button
                onClick={async () => {
                  if (!preview) await loadPreview();
                  setConfirmSend(true);
                }}
                disabled={!!busy || event.status === 'blocked'}
                className="px-4 py-2.5 rounded-xl border border-[#D3FB52]/40 text-[#D3FB52] text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-40"
              >
                <Send size={15} /> Send now
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

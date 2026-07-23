'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Bell, Check, Send, Eye, Clock, AlertTriangle, Plus, Trash2, CalendarClock,
} from 'lucide-react';

// The reminder cadence editor, inside the calendar item drawer.
//
// Pick a preset ("30 days out, 15 days out, the night before the deadline, and
// a same-day note"), or build your own. The panel always shows the REAL dates
// each rule resolves to and whether it has already gone out, because a cadence
// expressed only as offsets is impossible to sanity-check.

type Rule = {
  id: string;
  offsetDays: number;
  anchor: 'event' | 'deadline';
  tone: 'save-the-date' | 'signups-open' | 'last-call' | 'reminder' | 'day-of';
  enabled: boolean;
};

type ScheduleRow = {
  rule: Rule;
  sendOn: string | null;
  label: string;
  status: string;
  sentAt: string | null;
  recipients: number | null;
  sendStatus: string | null;
  detail: string | null;
};

type Preset = { key: string; name: string; description: string; rules: Rule[] };

type Payload = {
  cadence: Rule[];
  preset: string | null;
  presets: Preset[];
  suggested: Rule[];
  signupDeadline: string | null;
  eventDate: string | null;
  startTime: string | null;
  today: string;
  schedule: ScheduleRow[];
  recipientCount: number;
  audience: 'entrants' | 'club';
};

const TONES: Array<{ value: Rule['tone']; label: string }> = [
  { value: 'save-the-date', label: 'Save the date' },
  { value: 'signups-open', label: 'Sign up' },
  { value: 'reminder', label: 'Reminder' },
  { value: 'last-call', label: 'Last call' },
  { value: 'day-of', label: 'Day of' },
];

export default function RemindersTab({ itemId }: { itemId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/calendar/reminders?itemId=${itemId}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setData(json);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [itemId]);

  useEffect(() => { load(); }, [load]);

  async function save(patch: Record<string, unknown>) {
    setBusy('save'); setError(null);
    try {
      const res = await fetch('/api/calendar/reminders', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, ...patch }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await load();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  async function act(ruleId: string, mode: 'preview' | 'test' | 'send') {
    setBusy(`${mode}:${ruleId}`); setError(null); setMsg(null); setPreviewHtml(null);
    try {
      const res = await fetch('/api/calendar/reminders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, ruleId, mode }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'That did not work.');

      if (mode === 'preview') {
        setPreviewHtml(json.sampleHtml ?? null);
        setMsg(json.count != null ? `Would go to ${json.count} people.` : null);
      } else if (mode === 'test') {
        setMsg(json.sent ? 'Test sent to you.' : 'Could not send the test.');
      } else {
        setMsg(json.status === 'skipped'
          ? (json.detail ?? 'Already sent.')
          : `Sent to ${json.sent} of ${json.recipients}.`);
        await load();
      }
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  }

  function updateRule(id: string, patch: Partial<Rule>) {
    if (!data) return;
    save({ cadence: data.cadence.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }

  function addRule() {
    if (!data) return;
    const id = `c${Date.now().toString(36)}`;
    save({ cadence: [...data.cadence, { id, offsetDays: 7, anchor: 'event', tone: 'reminder', enabled: true }] });
  }

  function removeRule(id: string) {
    if (!data) return;
    save({ cadence: data.cadence.filter((r) => r.id !== id) });
  }

  if (loading) {
    return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin opacity-50" /></div>;
  }
  if (!data) {
    return <p className="text-sm" style={{ color: '#fca5a5' }}>{error ?? 'Could not load reminders.'}</p>;
  }

  return (
    <div className="space-y-4 text-sm">
      {!data.eventDate && (
        <div className="px-3 py-2 rounded-lg text-xs" style={{ background: '#3b2f0b', color: '#fde68a' }}>
          Give this event a date and the reminder dates will fill in.
        </div>
      )}

      {/* who it reaches */}
      <div className="flex items-center gap-2 text-xs opacity-70">
        <Bell className="w-3.5 h-3.5" />
        Reaches <strong>{data.recipientCount}</strong>{' '}
        {data.audience === 'entrants' ? 'people entered in this event' : 'club contacts'}
      </div>

      {/* preset picker */}
      <div>
        <div className="text-xs uppercase tracking-wide opacity-50 mb-1.5">Cadence</div>
        <div className="space-y-1.5">
          {data.presets.map((p) => (
            <button key={p.key} onClick={() => save({ preset: p.key })} disabled={busy === 'save'}
                    className="w-full text-left p-2 rounded-lg border"
                    style={data.preset === p.key
                      ? { borderColor: '#D3FB52', background: '#D3FB5212' }
                      : { borderColor: '#0d3d4d' }}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{p.name}</span>
                {data.preset === p.key && <Check className="w-3.5 h-3.5" style={{ color: '#D3FB52' }} />}
              </div>
              <div className="text-xs opacity-60 mt-0.5">{p.description}</div>
            </button>
          ))}
          {data.preset === null && (
            <div className="text-xs px-2 py-1.5 rounded-lg" style={{ background: '#0d3d4d' }}>
              Custom cadence — edit the rules below.
            </div>
          )}
        </div>
      </div>

      {/* signup deadline — the second anchor */}
      <label className="block">
        <span className="text-xs uppercase tracking-wide opacity-50 flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5" /> Signup deadline
        </span>
        <input
          type="date"
          value={data.signupDeadline ?? ''}
          onChange={(e) => save({ signup_deadline: e.target.value || null })}
          className="mt-1 w-full px-3 py-2 rounded-lg border text-sm"
          style={{ background: '#001820', borderColor: '#0d3d4d', color: '#e6f0f3' }}
        />
        <span className="text-xs opacity-50">
          Reminders anchored to the deadline count back from here. Leave blank to use the event date.
        </span>
      </label>

      {/* the schedule */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs uppercase tracking-wide opacity-50">Schedule</span>
          <button onClick={addRule} disabled={busy === 'save'}
                  className="text-xs flex items-center gap-1 opacity-70 hover:opacity-100">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>

        {data.schedule.length === 0 ? (
          <p className="text-xs opacity-60">No reminders set for this event.</p>
        ) : (
          <div className="space-y-1.5">
            {data.schedule.map((row) => {
              const sent = !!row.sentAt;
              return (
                <div key={row.rule.id} className="p-2 rounded-lg border"
                     style={{ borderColor: sent ? '#14532d' : '#0d3d4d',
                              background: row.rule.enabled ? '#001820' : 'transparent',
                              opacity: row.rule.enabled ? 1 : 0.5 }}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={row.rule.enabled} disabled={sent || busy === 'save'}
                           onChange={(e) => updateRule(row.rule.id, { enabled: e.target.checked })}
                           className="w-3.5 h-3.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-xs">{row.label}</span>
                        {row.sendOn && (
                          <span className="text-xs" style={{ color: sent ? '#86efac' : '#D3FB52' }}>
                            {sent ? '✓ sent' : dateLabel(row.sendOn)}
                          </span>
                        )}
                        {row.status === 'past' && !sent && (
                          <span className="text-xs flex items-center gap-1" style={{ color: '#fbbf24' }}>
                            <AlertTriangle className="w-3 h-3" /> date passed
                          </span>
                        )}
                      </div>
                      {sent && (
                        <div className="text-[11px] opacity-60">
                          {row.recipients} recipient{row.recipients === 1 ? '' : 's'}
                          {row.detail ? ` · ${row.detail}` : ''}
                        </div>
                      )}
                    </div>
                    {!sent && (
                      <button onClick={() => removeRule(row.rule.id)} disabled={busy === 'save'}
                              className="opacity-40 hover:opacity-100">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {!sent && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 pl-5">
                      <input type="number" min={0} max={365} value={row.rule.offsetDays}
                             onChange={(e) => updateRule(row.rule.id, { offsetDays: Number(e.target.value) })}
                             className="w-14 px-1.5 py-1 rounded border text-xs"
                             style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }} />
                      <span className="text-xs opacity-60">days before</span>
                      <select value={row.rule.anchor}
                              onChange={(e) => updateRule(row.rule.id, { anchor: e.target.value as Rule['anchor'] })}
                              className="px-1.5 py-1 rounded border text-xs"
                              style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}>
                        <option value="event">the event</option>
                        <option value="deadline">the deadline</option>
                      </select>
                      <select value={row.rule.tone}
                              onChange={(e) => updateRule(row.rule.id, { tone: e.target.value as Rule['tone'] })}
                              className="px-1.5 py-1 rounded border text-xs"
                              style={{ background: '#002838', borderColor: '#0d3d4d', color: '#e6f0f3' }}>
                        {TONES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  )}

                  <div className="flex gap-1.5 mt-2 pl-5">
                    <button onClick={() => act(row.rule.id, 'preview')} disabled={!!busy}
                            className="text-[11px] px-2 py-1 rounded border flex items-center gap-1"
                            style={{ borderColor: '#0d3d4d' }}>
                      {busy === `preview:${row.rule.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                      Preview
                    </button>
                    <button onClick={() => act(row.rule.id, 'test')} disabled={!!busy}
                            className="text-[11px] px-2 py-1 rounded border flex items-center gap-1"
                            style={{ borderColor: '#0d3d4d' }}>
                      {busy === `test:${row.rule.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Test to me
                    </button>
                    {!sent && (
                      <button onClick={() => act(row.rule.id, 'send')} disabled={!!busy}
                              className="text-[11px] px-2 py-1 rounded flex items-center gap-1 font-medium"
                              style={{ background: '#0d3d4d', color: '#e6f0f3' }}>
                        {busy === `send:${row.rule.id}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Clock className="w-3 h-3" />}
                        Send now
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] opacity-50">
        Reminders go out automatically each morning. Once one has been sent it can&apos;t be sent again,
        so nobody ever gets the same email twice.
      </p>

      {msg && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: '#0d3d4d', color: '#cde8f0' }}>{msg}</div>}
      {error && <div className="text-xs px-3 py-2 rounded-lg" style={{ background: '#4c1d1d', color: '#fecaca' }}>{error}</div>}

      {previewHtml && (
        <div className="rounded-lg overflow-hidden border" style={{ borderColor: '#0d3d4d' }}>
          <iframe title="Reminder preview" srcDoc={previewHtml}
                  className="w-full bg-white" style={{ height: 420 }} />
        </div>
      )}
    </div>
  );
}

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow]}, ${MON[m - 1]} ${d}`;
}

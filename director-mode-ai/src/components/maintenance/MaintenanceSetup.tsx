'use client';

/**
 * Setup (owner / directors): the daily routine, the morning digest, the crew.
 *
 * Nothing is ever added for you. The template list starts with nothing
 * ticked; only what you pick is created.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, Loader2, Mail, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { DAY_PRESETS, describeDays } from '@/lib/maintenance/routine';
import { time12, hhmm } from '@/lib/maintenance/dates';
import { DEPARTMENTS, DEPARTMENT_LABEL, type Department, type RoutineItem } from '@/lib/maintenance/types';
import type { StarterItem } from '@/lib/maintenance/starter';
import { ACCENT, FIELD, fieldCls, api, ghostBtn, primaryBtn, Sheet } from './ui';

type Row = RoutineItem & { due14: number; missed14: number };

export default function MaintenanceSetup({
  crewCount,
  intent,
  onIntentHandled,
  onChanged,
}: {
  crewCount: number;
  intent: 'starter' | 'add' | null;
  onIntentHandled: () => void;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<Row[] | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [starter, setStarter] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await api<{ items: Row[] }>('GET', '/api/maintenance/routine');
    setItems(j.items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (intent === 'starter') setStarter(true);
    if (intent === 'add') setEditing('new');
    if (intent) onIntentHandled();
  }, [intent, onIntentHandled]);

  const changed = async () => {
    await load();
    await onChanged();
  };

  const move = async (i: number, dir: -1 | 1) => {
    if (!items) return;
    const a = items[i];
    const b = items[i + dir];
    if (!a || !b) return;
    try {
      await Promise.all([
        api('PATCH', `/api/maintenance/routine/${a.id}`, { sort_order: b.sort_order }),
        api('PATCH', `/api/maintenance/routine/${b.id}`, { sort_order: a.sort_order }),
      ]);
      await changed();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="mt-5 space-y-6">
      {/* Routine */}
      <section className="rounded-2xl border border-white/10 bg-[#002838] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Daily routine</h2>
          <div className="flex gap-2">
            <button onClick={() => setStarter(true)} className={ghostBtn}>
              From a template
            </button>
            <button onClick={() => setEditing('new')} className={primaryBtn}>
              <Plus size={16} /> Add item
            </button>
          </div>
        </div>
        {err && <p className="mt-2 text-[14px] text-red-300">{err}</p>}
        {!items ? (
          <p className="mt-4 text-white/50">Loading…</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-[14px] text-white/55">No routine items yet — add your own, or pick from the template.</p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {items.map((it, i) => (
              <li key={it.id} className="flex items-center gap-2 py-2.5">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-white/40 disabled:opacity-20" aria-label="Move up">
                    <ArrowUp size={14} />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1 text-white/40 disabled:opacity-20" aria-label="Move down">
                    <ArrowDown size={14} />
                  </button>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] text-white">{it.title}</p>
                  <p className="text-[12.5px] text-white/45">
                    {[describeDays(it.days_of_week), it.target_time ? `by ${time12(it.target_time)}` : 'anytime', it.location, DEPARTMENT_LABEL[it.department]]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {it.missed14 > 0 && (
                    <p className="text-[12.5px] text-amber-300">
                      Missed {it.missed14} of the last {it.due14} {it.due14 === 1 ? 'day' : 'days'} it was due
                    </p>
                  )}
                </div>
                <button onClick={() => setEditing(it)} className="rounded-lg p-2 text-white/50 hover:text-white" aria-label="Edit">
                  <Pencil size={16} />
                </button>
                <button
                  onClick={async () => {
                    if (!confirm(`Remove “${it.title}” from the routine? Its history is kept.`)) return;
                    try {
                      await api('DELETE', `/api/maintenance/routine/${it.id}`);
                      await changed();
                    } catch (e) {
                      setErr((e as Error).message);
                    }
                  }}
                  className="rounded-lg p-2 text-white/40 hover:text-red-300"
                  aria-label="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DigestCard crewCount={crewCount} />

      <section className="rounded-2xl border border-white/10 bg-[#002838] p-4">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold">
          <Users size={18} /> Maintenance crew
        </h2>
        <p className="mt-1 text-[14px] text-white/60">
          {crewCount === 0
            ? 'No one on the crew yet.'
            : `${crewCount} ${crewCount === 1 ? 'person' : 'people'} on the crew.`}{' '}
          Crew members get their own login, see only MaintenanceMode, and get the morning email.
        </p>
        <Link href="/club/people?role=maintenance" className={`${ghostBtn} mt-3`}>
          Invite maintenance staff
        </Link>
      </section>

      {editing && (
        <ItemSheet
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await changed();
          }}
        />
      )}
      {starter && (
        <StarterSheet
          existing={new Set((items ?? []).map((i) => i.title.toLowerCase()))}
          onClose={() => setStarter(false)}
          onAdded={async () => {
            setStarter(false);
            await changed();
          }}
        />
      )}
    </div>
  );
}

const DAY_CHIPS = [
  { d: 0, l: 'S' },
  { d: 1, l: 'M' },
  { d: 2, l: 'T' },
  { d: 3, l: 'W' },
  { d: 4, l: 'T' },
  { d: 5, l: 'F' },
  { d: 6, l: 'S' },
];

function ItemSheet({ item, onClose, onSaved }: { item: RoutineItem | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [department, setDepartment] = useState<Department>(item?.department ?? 'tennis');
  const [days, setDays] = useState<number[]>(item?.days_of_week ?? DAY_PRESETS.every);
  const [time, setTime] = useState(hhmm(item?.target_time) ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggle = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const body = { title, location, department, days_of_week: days, target_time: time || null, notes };
      if (item) await api('PATCH', `/api/maintenance/routine/${item.id}`, body);
      else await api('POST', '/api/maintenance/routine', body);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title={item ? 'Edit routine item' : 'Add a routine item'} onClose={onClose}>
      <div className="space-y-3">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Blow off courts 1–10" style={FIELD} className={fieldCls} autoFocus />
        <div className="grid grid-cols-2 gap-2">
          <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Where" style={FIELD} className={fieldCls} />
          <select value={department} onChange={(e) => setDepartment(e.target.value as Department)} style={FIELD} className={fieldCls}>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABEL[d]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="mb-1 text-[13px] text-white/50">Which days</p>
          <div className="flex gap-1.5">
            {DAY_CHIPS.map((c) => (
              <button
                key={c.d}
                type="button"
                onClick={() => toggle(c.d)}
                className={`h-11 w-11 rounded-full border text-[14px] font-semibold ${days.includes(c.d) ? 'border-transparent text-[#1a1200]' : 'border-white/15 text-white/60'}`}
                style={days.includes(c.d) ? { background: ACCENT } : undefined}
              >
                {c.l}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-3 text-[13px]" style={{ color: ACCENT }}>
            <button type="button" onClick={() => setDays(DAY_PRESETS.every)}>Every day</button>
            <button type="button" onClick={() => setDays(DAY_PRESETS.weekdays)}>Weekdays</button>
            <button type="button" onClick={() => setDays(DAY_PRESETS.weekends)}>Weekends</button>
          </div>
        </div>
        <label className="block text-[13px] text-white/50">
          Done by (optional)
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={FIELD} className={`${fieldCls} mt-1`} />
        </label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Instructions (optional)" rows={2} style={FIELD} className={fieldCls} />
        {err && <p className="text-[14px] text-red-300">{err}</p>}
        <button onClick={save} disabled={busy || !title.trim() || days.length === 0} className={`${primaryBtn} w-full`}>
          {busy && <Loader2 size={16} className="animate-spin" />} {item ? 'Save' : 'Add to the routine'}
        </button>
      </div>
    </Sheet>
  );
}

function StarterSheet({ existing, onClose, onAdded }: { existing: Set<string>; onClose: () => void; onAdded: () => void }) {
  const [list, setList] = useState<StarterItem[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api<{ items: StarterItem[] }>('GET', '/api/maintenance/routine/starter').then((j) => setList(j.items));
  }, []);

  const add = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api('POST', '/api/maintenance/routine/starter', { keys: [...picked] });
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="Pick from common chores" onClose={onClose}>
      <p className="mb-3 text-[14px] text-white/60">Tick the ones your club does. You can change days and times afterwards.</p>
      <ul className="space-y-1.5">
        {list.map((s) => {
          const have = existing.has(s.title.toLowerCase());
          const on = picked.has(s.key);
          return (
            <li key={s.key}>
              <label className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 ${have ? 'border-white/5 opacity-50' : on ? 'border-amber-400/50 bg-amber-400/10' : 'border-white/10'}`}>
                <input
                  type="checkbox"
                  disabled={have}
                  checked={on}
                  onChange={() =>
                    setPicked((cur) => {
                      const next = new Set(cur);
                      if (next.has(s.key)) next.delete(s.key);
                      else next.add(s.key);
                      return next;
                    })
                  }
                  className="h-5 w-5 accent-amber-400"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-white">{s.title}</span>
                  <span className="block text-[12.5px] text-white/45">
                    {[s.location, s.target_time ? `by ${time12(s.target_time)}` : 'anytime', have ? 'already on your routine' : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {err && <p className="mt-2 text-[14px] text-red-300">{err}</p>}
      <button onClick={add} disabled={busy || picked.size === 0} className={`${primaryBtn} mt-4 w-full`}>
        {busy && <Loader2 size={16} className="animate-spin" />} Add {picked.size || ''} selected
      </button>
    </Sheet>
  );
}

function DigestCard({ crewCount }: { crewCount: number }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [crew, setCrew] = useState<{ id: string; name: string }[]>([]);
  const [preview, setPreview] = useState<{ subject: string; html: string; isEmpty: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void api<{ digest_enabled: boolean; crew: { id: string; name: string }[] }>('GET', '/api/maintenance/settings').then((j) => {
      setEnabled(j.digest_enabled);
      setCrew(j.crew);
    });
  }, [crewCount]);

  const act = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-[#002838] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold">
          <Mail size={18} /> Morning email
        </h2>
        {enabled !== null && (
          <label className="flex items-center gap-2 text-[14px] text-white/70">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) =>
                act('toggle', async () => {
                  await api('PATCH', '/api/maintenance/settings', { digest_enabled: e.target.checked });
                  setEnabled(e.target.checked);
                })
              }
              className="h-5 w-5 accent-amber-400"
            />
            {enabled ? 'On' : 'Off'}
          </label>
        )}
      </div>
      <p className="mt-1 text-[14px] text-white/60">
        Every morning at 6 AM the crew gets what was missed yesterday, what’s urgent, today’s routine and project progress.
        {crew.length ? ` Goes to: ${crew.map((c) => c.name).join(', ')}.` : ' It starts once someone is on the crew.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => act('preview', async () => setPreview(await api('GET', '/api/maintenance/digest')))}
          disabled={!!busy}
          className={ghostBtn}
        >
          {busy === 'preview' && <Loader2 size={16} className="animate-spin" />} Preview today’s email
        </button>
        <button
          onClick={() =>
            act('test', async () => {
              const j = await api<{ to: string }>('POST', '/api/maintenance/digest');
              setMsg(`Test sent to ${j.to}.`);
            })
          }
          disabled={!!busy}
          className={ghostBtn}
        >
          {busy === 'test' && <Loader2 size={16} className="animate-spin" />} Send a test to me
        </button>
      </div>
      {msg && <p className="mt-2 text-[14px] text-white/70">{msg}</p>}
      {preview && (
        <div className="mt-3">
          <p className="text-[13px] text-white/50">
            Subject: <span className="text-white/80">{preview.subject}</span>
            {preview.isEmpty ? ' — nothing to report, so it would not be sent today.' : ''}
          </p>
          <iframe title="Digest preview" srcDoc={preview.html} className="mt-2 h-[460px] w-full rounded-xl border border-white/10 bg-white" />
        </div>
      )}
    </section>
  );
}

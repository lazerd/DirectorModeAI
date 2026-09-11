'use client';

/**
 * One long-term project: its steps (anyone ticks them), its updates log, and
 * — for the owner / directors — editing, status and delete.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, HardHat, Loader2, Plus, Trash2 } from 'lucide-react';
import { shortDate } from '@/lib/maintenance/dates';
import {
  DEPARTMENT_LABEL, PROJECT_STATUSES, PROJECT_STATUS_LABEL,
  type Project, type ProjectStatus, type ProjectStep, type Update,
} from '@/lib/maintenance/types';
import { ACCENT, FIELD, fieldCls, api, ghostBtn, primaryBtn, Pill, PhotoPicker, type Photo } from './ui';

type Payload = {
  today: string;
  me: { id: string; canManage: boolean; isCrew: boolean };
  project: Project & { pct: number | null; pastTarget: boolean };
  steps: ProjectStep[];
  updates: Update[];
  names: Record<string, string>;
};

export default function ProjectClient({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newStep, setNewStep] = useState('');
  const [update, setUpdate] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>('GET', `/api/maintenance/projects/${projectId}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }, [projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const who = (id: string | null) => (!id ? 'Someone' : id === data?.me.id ? 'You' : data?.names[id] || 'Someone');

  if (!data) {
    return (
      <div className="min-h-screen bg-[#001820] p-6 text-white">
        {err ? <p className="text-red-300">{err}</p> : <p className="flex items-center gap-2 text-white/50"><Loader2 size={16} className="animate-spin" /> Loading…</p>}
      </div>
    );
  }

  const { project, steps, updates, me } = data;

  return (
    <div className="min-h-screen bg-[#001820] pb-16 text-white">
      <div className="mx-auto max-w-3xl px-4 pt-6 md:px-6">
        <Link href="/maintenance" className="inline-flex min-h-[44px] items-center gap-1.5 text-[14px] text-white/55 hover:text-white">
          <ArrowLeft size={16} /> MaintenanceMode
        </Link>

        <div className="mt-2 flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={{ background: `${ACCENT}22`, color: ACCENT }}>
            <HardHat size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{project.title}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Pill tone={project.status === 'active' ? 'amber' : project.status === 'done' ? 'green' : 'muted'}>{PROJECT_STATUS_LABEL[project.status]}</Pill>
              <Pill>{DEPARTMENT_LABEL[project.department]}</Pill>
              {project.location && <Pill>{project.location}</Pill>}
              {project.target_date && <Pill tone={project.pastTarget ? 'red' : 'muted'}>{project.pastTarget ? 'Past target' : 'Target'} {shortDate(project.target_date)}</Pill>}
            </div>
          </div>
        </div>

        {project.description && <p className="mt-4 whitespace-pre-wrap text-[15px] text-white/75">{project.description}</p>}

        {project.pct != null && (
          <div className="mt-4">
            <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full" style={{ width: `${project.pct}%`, background: ACCENT }} />
            </div>
            <p className="mt-1 text-[13px] text-white/55">{project.pct}% of steps done</p>
          </div>
        )}

        {err && <p className="mt-3 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{err}</p>}

        {me.canManage && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <select
              value={project.status}
              onChange={(e) => run('status', () => api('PATCH', `/api/maintenance/projects/${project.id}`, { status: e.target.value as ProjectStatus }))}
              style={FIELD}
              className="min-h-[44px] rounded-xl border border-white/15 px-3 text-[14px]"
            >
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROJECT_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (confirm('Delete this project, its steps and its updates?')) {
                  void run('delete', async () => {
                    await api('DELETE', `/api/maintenance/projects/${project.id}`);
                    router.push('/maintenance');
                  });
                }
              }}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-400/30 px-3 text-[14px] text-red-300"
            >
              <Trash2 size={15} /> Delete project
            </button>
          </div>
        )}

        {/* Steps */}
        <section className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-white/45">Steps</h2>
          {steps.length === 0 && <p className="text-[14px] text-white/45">No steps yet{me.canManage ? ' — add the first one below.' : '.'}</p>}
          <ul className="space-y-2">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <button
                  onClick={() => run(`step-${s.id}`, () => api('PATCH', `/api/maintenance/projects/${project.id}/steps/${s.id}`, { done: !s.done }))}
                  disabled={!!busy}
                  className={`flex min-h-[56px] flex-1 items-center gap-3 rounded-2xl border px-4 text-left ${s.done ? 'border-white/5 bg-white/[0.02]' : 'border-white/10 bg-[#002838]'}`}
                >
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 ${s.done ? 'border-transparent text-[#1a1200]' : 'border-white/30'}`}
                    style={s.done ? { background: ACCENT } : undefined}
                  >
                    {s.done && <Check size={16} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] ${s.done ? 'text-white/45 line-through decoration-white/20' : ''}`}>{s.title}</span>
                    {s.done && s.done_at && (
                      <span className="block text-[12.5px] text-white/40">
                        {who(s.done_by)} · {new Date(s.done_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                    )}
                  </span>
                </button>
                {me.canManage && (
                  <button
                    onClick={() => run(`del-${s.id}`, () => api('DELETE', `/api/maintenance/projects/${project.id}/steps/${s.id}`))}
                    className="rounded-lg p-2 text-white/35 hover:text-red-300"
                    aria-label="Remove step"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {me.canManage && (
            <div className="mt-2 flex gap-2">
              <input value={newStep} onChange={(e) => setNewStep(e.target.value)} placeholder="Add a step" style={FIELD} className={fieldCls} />
              <button
                onClick={() =>
                  newStep.trim() &&
                  run('add-step', async () => {
                    await api('POST', `/api/maintenance/projects/${project.id}/steps`, { title: newStep });
                    setNewStep('');
                  })
                }
                className={ghostBtn}
              >
                <Plus size={16} />
              </button>
            </div>
          )}
        </section>

        {/* Updates */}
        <section className="mt-8">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-white/45">Updates</h2>
          <div className="space-y-2 rounded-2xl border border-white/10 bg-[#002838] p-3">
            <textarea value={update} onChange={(e) => setUpdate(e.target.value)} placeholder="Post an update — what happened, what's next" rows={2} style={FIELD} className={fieldCls} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <PhotoPicker value={photo} onChange={setPhoto} />
              <button
                onClick={() =>
                  update.trim() &&
                  run('update', async () => {
                    await api('POST', '/api/maintenance/updates', { project_id: project.id, body: update, photo_path: photo?.path });
                    setUpdate('');
                    setPhoto(null);
                  })
                }
                disabled={!!busy || !update.trim()}
                className={primaryBtn}
              >
                {busy === 'update' && <Loader2 size={16} className="animate-spin" />} Post update
              </button>
            </div>
          </div>
          <ul className="mt-3 space-y-2">
            {updates.map((u) => (
              <li key={u.id} className="rounded-2xl border border-white/5 bg-white/[0.03] p-3">
                <p className="text-[12.5px] text-white/45">
                  {who(u.author_id)} · {new Date(u.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[15px] text-white/85">{u.body}</p>
                {u.photo_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={u.photo_url} alt="" className="mt-2 max-h-72 rounded-xl object-cover" />
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

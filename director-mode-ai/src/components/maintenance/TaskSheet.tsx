'use client';

/**
 * One task, opened from the board: the photo, where it is, who posted it,
 * the notes log, and big buttons to move it along.
 */
import { useEffect, useState } from 'react';
import { Check, Loader2, Play, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { canDeleteTask, canEditTask, isOverdue } from '@/lib/maintenance/tasks';
import { shortDate } from '@/lib/maintenance/dates';
import { DEPARTMENT_LABEL, TASK_STATUS_LABEL, type Task, type Update } from '@/lib/maintenance/types';
import { FIELD, fieldCls, api, ghostBtn, primaryBtn, Pill, PhotoPicker, PriorityPill, Sheet, type Photo } from './ui';

export default function TaskSheet({
  task,
  today,
  meId,
  canManage,
  who,
  onClose,
  onChanged,
}: {
  task: Task;
  today: string;
  meId: string;
  canManage: boolean;
  who: (id: string | null) => string;
  onClose: () => void;
  onChanged: (msg?: string) => void;
}) {
  const [finishing, setFinishing] = useState(false);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');

  const actor = { userId: meId, canManage };
  const mayEdit = canEditTask(actor, task);
  const mayDelete = canDeleteTask(actor, task);

  const loadUpdates = async () => {
    const j = await api<{ updates: Update[]; names: Record<string, string> }>('GET', `/api/maintenance/updates?task_id=${task.id}`);
    setUpdates(j.updates);
    setNames(j.names);
  };
  useEffect(() => {
    void loadUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  const run = async (key: string, fn: () => Promise<unknown>, msg?: string) => {
    setBusy(key);
    setErr(null);
    try {
      await fn();
      onChanged(msg);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = (status: Task['status'], extra: Record<string, unknown> = {}, msg?: string) =>
    run(status, () => api('PATCH', `/api/maintenance/tasks/${task.id}`, { status, ...extra }), msg);

  const overdue = isOverdue(task, today);
  const name = (id: string | null) => (id && names[id]) || who(id);

  return (
    <Sheet open title={task.title} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-1.5">
        <PriorityPill p={task.priority} />
        <Pill tone={task.status === 'done' ? 'green' : task.status === 'in_progress' ? 'amber' : 'muted'}>{TASK_STATUS_LABEL[task.status]}</Pill>
        {overdue && <Pill tone="red">Overdue</Pill>}
        {task.due_date && !overdue && <Pill>Due {shortDate(task.due_date)}</Pill>}
      </div>
      {task.photo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={task.photo_url} alt="" className="mt-3 max-h-72 w-full rounded-xl object-cover" />
      )}
      <p className="mt-3 text-[14px] text-white/55">
        {[task.location, DEPARTMENT_LABEL[task.department], `posted by ${who(task.created_by)}`].filter(Boolean).join(' · ')}
      </p>
      {task.description && <p className="mt-2 whitespace-pre-wrap text-[15px] text-white/80">{task.description}</p>}
      {task.status === 'done' && (
        <div className="mt-3 rounded-xl border border-emerald-400/25 bg-emerald-500/[0.07] p-3 text-[14px] text-emerald-100">
          Done by {who(task.completed_by)}
          {task.completion_note ? ` — “${task.completion_note}”` : ''}
          {task.completion_photo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={task.completion_photo_url} alt="" className="mt-2 max-h-60 rounded-lg object-cover" />
          )}
        </div>
      )}

      {err && <p className="mt-3 text-[14px] text-red-300">{err}</p>}

      {/* Actions */}
      {finishing ? (
        <div className="mt-4 space-y-3">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do? (optional)" rows={2} style={FIELD} className={fieldCls} />
          <PhotoPicker value={photo} onChange={setPhoto} label="Add an “after” photo" />
          <button
            onClick={() => setStatus('done', { completion_note: note, completion_photo_path: photo?.path }, 'Marked done ✓')}
            disabled={!!busy}
            className={`${primaryBtn} w-full`}
          >
            {busy === 'done' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Mark done
          </button>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {task.status === 'open' && (
            <button onClick={() => setStatus('in_progress', {}, 'Started')} disabled={!!busy} className={ghostBtn}>
              <Play size={16} /> Start
            </button>
          )}
          {(task.status === 'open' || task.status === 'in_progress') && (
            <button onClick={() => setFinishing(true)} disabled={!!busy} className={`${primaryBtn} ${task.status === 'in_progress' ? 'col-span-2' : ''}`}>
              <Check size={16} /> Done
            </button>
          )}
          {(task.status === 'done' || task.status === 'cancelled') && (
            <button onClick={() => setStatus('open', {}, 'Reopened')} disabled={!!busy} className={`${ghostBtn} col-span-2`}>
              <RotateCcw size={16} /> Reopen
            </button>
          )}
        </div>
      )}

      {/* Notes log */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <h4 className="text-[13px] font-semibold uppercase tracking-wide text-white/45">Notes</h4>
        {updates.length === 0 && <p className="mt-1 text-[14px] text-white/40">No notes yet.</p>}
        <ul className="mt-2 space-y-2">
          {updates.map((u) => (
            <li key={u.id} className="rounded-xl bg-white/[0.04] p-2.5 text-[14px] text-white/80">
              <span className="text-white/45">{name(u.author_id)}: </span>
              {u.body}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note" style={FIELD} className={fieldCls} />
          <button
            onClick={async () => {
              if (!comment.trim()) return;
              try {
                await api('POST', '/api/maintenance/updates', { task_id: task.id, body: comment });
                setComment('');
                await loadUpdates();
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
            className={ghostBtn}
          >
            Add
          </button>
        </div>
      </div>

      {(mayEdit || mayDelete) && task.status !== 'done' && task.status !== 'cancelled' && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {mayEdit && (
            <button onClick={() => setStatus('cancelled', {}, 'Cancelled')} disabled={!!busy} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-white/15 px-3 text-[14px] text-white/60">
              <XCircle size={15} /> Cancel task
            </button>
          )}
          {mayDelete && (
            <button
              onClick={() => {
                if (confirm('Delete this task for good?')) void run('delete', () => api('DELETE', `/api/maintenance/tasks/${task.id}`), 'Deleted');
              }}
              disabled={!!busy}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-red-400/30 px-3 text-[14px] text-red-300"
            >
              <Trash2 size={15} /> Delete
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

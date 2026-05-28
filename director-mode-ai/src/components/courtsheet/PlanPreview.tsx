'use client';

/**
 * Plan preview modal — shown before any AI-emitted plan is applied.
 *
 * Surfaces:
 *   - One-line summary (instance count, span)
 *   - Conflict list (each one specifically)
 *   - toCreate/toModify/toCancel counts
 *   - Buttons: Confirm · Skip conflicts (if any) · Cancel
 */

import { useState } from 'react';
import { Sparkles, AlertTriangle, X, Calendar, Clock, MapPin, Loader2, Check, Undo2 } from 'lucide-react';
import type { Plan } from '@/lib/courtsheet/types';

interface Props {
  open: boolean;
  plan: Plan | null;
  summary: string | null;
  aiMessage: string | null;
  onClose: () => void;
  onConfirm: (opts: { skipConflicting: boolean }) => Promise<void>;
}

export default function PlanPreview({ open, plan, summary, aiMessage, onClose, onConfirm }: Props) {
  const [submitting, setSubmitting] = useState(false);

  if (!open || !plan) return null;

  const hasConflicts = plan.conflicts.length > 0;
  const isDestructive = plan.toCancel.length > 0;
  const isLarge = plan.summary.instance_count > 50;

  const handle = async (skipConflicting: boolean) => {
    setSubmitting(true);
    try {
      await onConfirm({ skipConflicting });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-3xl bg-[#001820] border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-white/[0.06] flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl bg-[#D3FB52]/10 border border-[#D3FB52]/20 flex items-center justify-center shrink-0">
            <Sparkles size={16} className="text-[#D3FB52]" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-widest text-[#D3FB52] mb-0.5">
              Preview
            </div>
            <h2 className="text-base sm:text-lg font-semibold text-white truncate">
              {summary ?? 'Confirm changes'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 sm:px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {aiMessage && (
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2 text-sm text-white/70 italic">
              {aiMessage}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <Stat icon={Calendar} label="Days" value={plan.summary.day_count} />
            <Stat icon={MapPin} label="Courts" value={plan.summary.court_count} />
            <Stat icon={Clock} label={isDestructive ? 'Cancel' : 'Total'} value={isDestructive ? plan.toCancel.length : plan.summary.instance_count} />
          </div>

          {/* Span line */}
          <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2">
            <div className="text-[10px] uppercase tracking-widest text-white/40 mb-0.5">When</div>
            <div className="text-sm font-medium tabular-nums">{plan.summary.spans}</div>
          </div>

          {/* Conflicts */}
          {hasConflicts && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-3">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-amber-300" />
                <div className="text-sm font-medium text-amber-200">
                  {plan.conflicts.length} conflict{plan.conflicts.length === 1 ? '' : 's'} found
                </div>
              </div>
              <ul className="space-y-1 max-h-32 overflow-y-auto">
                {plan.conflicts.slice(0, 8).map((c, i) => (
                  <li key={i} className="text-xs text-amber-100/80">
                    {c.candidate.court_label}, {c.candidate.starts_at.slice(0, 10)}{' '}
                    {c.against.kind === 'existing' ? (
                      <>— blocked by "{c.against.title}"</>
                    ) : (
                      <>— overlaps another new reservation</>
                    )}
                  </li>
                ))}
                {plan.conflicts.length > 8 && (
                  <li className="text-xs text-amber-100/50">…and {plan.conflicts.length - 8} more</li>
                )}
              </ul>
            </div>
          )}

          {/* Bulk warning */}
          {(isLarge || isDestructive) && !hasConflicts && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 flex items-start gap-2">
              <AlertTriangle size={14} className="text-white/40 mt-0.5 shrink-0" />
              <div className="text-xs text-white/60">
                {isDestructive && `${plan.toCancel.length} reservation${plan.toCancel.length === 1 ? '' : 's'} will be cancelled. `}
                {isLarge && `Large batch — review the details above before confirming.`}
                {' '}You can <Undo2 size={10} className="inline -mt-0.5" /> Undo right after.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-4 bg-white/[0.02] border-t border-white/[0.06] flex flex-col-reverse sm:flex-row gap-2 sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium text-white/80 disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {hasConflicts && (
              <button
                type="button"
                onClick={() => handle(true)}
                disabled={submitting}
                className="flex-1 sm:flex-none px-3 py-2 rounded-xl bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/30 text-amber-200 text-sm font-medium disabled:opacity-50"
              >
                Skip conflicts &amp; apply rest
              </button>
            )}
            <button
              type="button"
              onClick={() => handle(false)}
              disabled={submitting || hasConflicts}
              className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-[#D3FB52] hover:bg-[#c5f035] text-[#001820] text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {submitting ? 'Applying…' : 'Confirm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Sparkles;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-white/40 mb-1">
        <Icon size={9} />
        {label}
      </div>
      <div className="text-lg font-bold tabular-nums text-white">{value}</div>
    </div>
  );
}

'use client';

/**
 * "Ask your pipeline" — one input, plain answers, and actions you confirm.
 *
 * The thing Darrin wanted after Dreamforce: talk to the pipeline instead of
 * clicking through it. 522 clubs is past the size where a board is a useful
 * way to ask "which West clubs have no contact?", and it was never a good way
 * to ask "what happened with Rossmoor?".
 *
 * TWO RULES THIS COMPONENT EXISTS TO ENFORCE:
 *
 *   1. An action is never applied by the model. The server answers with a
 *      proposal — a sentence and an argument bag — and this draws it with
 *      Confirm and Cancel. Only the Confirm click posts to
 *      /api/crm/ask/confirm, which re-validates everything before it writes.
 *      Cancel writes nothing and says so.
 *   2. Nothing sends email. A draft proposal confirms into the compose panel
 *      on the club's page, which still requires the preview and the Send
 *      button that were there before. There is no path from this box to
 *      Resend, and the assistant is told to say so.
 *
 * The transcript lives in component state and dies with the page. There is no
 * table for it: two reps asking short questions do not need a history, and one
 * would be a second place CRM data lives.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export interface AskProposal {
  action: string;
  title: string;
  detail: string[];
  args: Record<string, unknown>;
}

export interface AskDraft {
  org_id: string;
  contact_id: string;
  subject: string;
  body: string;
}

type TurnStatus = 'open' | 'applied' | 'cancelled' | 'failed';

interface Turn {
  role: 'you' | 'pipeline';
  text: string;
  proposal?: AskProposal;
  status?: TurnStatus;
  outcome?: string;
}

/** Where a draft waits while the browser moves to the club's page. */
export const DRAFT_KEY = 'crm:ask-draft';

const PIPELINE_SUGGESTIONS = [
  "What's overdue?",
  "Who haven't we followed up with?",
  'Which West clubs have no contact?',
  'How big is the pipeline?',
];

export default function AskBox({
  orgId = null,
  clubName = null,
  onDraft,
  onApplied,
}: {
  /** Set on /crm/[id]: every question and action is pinned to this club. */
  orgId?: string | null;
  clubName?: string | null;
  /** The club page handles a draft in place; /crm hands off by navigating. */
  onDraft?: (d: AskDraft) => void;
  /** Something was applied — the page should re-read itself. */
  onApplied?: () => void;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const suggestions = clubName
    ? ['What happened here?', 'Log a note', 'Set a next step for Friday', 'Draft an intro email']
    : PIPELINE_SUGGESTIONS;

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [turns]);

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      setQuestion('');
      // The history sent up is the plain text of both sides — enough for "and
      // the East ones?" to make sense, and nothing the server has to trust.
      const history = turns.map((t) => ({ role: t.role === 'you' ? 'user' : 'assistant', content: t.text }));
      setTurns((list) => [...list, { role: 'you', text: q }]);
      setBusy(true);
      try {
        const res = await fetch('/api/crm/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: q, history, org_id: orgId }),
        });
        const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          setTurns((list) => [
            ...list,
            { role: 'pipeline', text: String(j.message ?? j.error ?? 'That did not work.'), status: 'failed' },
          ]);
          return;
        }
        setTurns((list) => [
          ...list,
          {
            role: 'pipeline',
            text: String(j.text ?? ''),
            proposal: (j.proposal as AskProposal | undefined) ?? undefined,
            status: j.proposal ? 'open' : undefined,
          },
        ]);
      } catch {
        setTurns((list) => [...list, { role: 'pipeline', text: 'No answer came back.', status: 'failed' }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, orgId, turns],
  );

  async function confirm(index: number) {
    const turn = turns[index];
    if (!turn?.proposal || confirming) return;
    setConfirming(true);
    try {
      const res = await fetch('/api/crm/ask/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal: turn.proposal, org_id: orgId }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setTurns((list) =>
          list.map((t, i) => (i === index ? { ...t, status: 'failed', outcome: String(j.error ?? 'It would not apply.') } : t)),
        );
        return;
      }
      const draft = j.draft as AskDraft | undefined;
      setTurns((list) =>
        list.map((t, i) => (i === index ? { ...t, status: 'applied', outcome: String(j.message ?? 'Done.') } : t)),
      );
      if (draft) {
        // A draft is not a change; it is a handoff to the composer. On the
        // club's own page that is a callback. From /crm it is a short trip
        // through sessionStorage — the alternative is a subject and a body in
        // a query string, which is a URL bar full of an email.
        if (onDraft) onDraft(draft);
        else {
          try {
            window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
          } catch {
            // Storage blocked: the club page still opens, just without it.
          }
          router.push(`/crm/${draft.org_id}`);
        }
        return;
      }
      onApplied?.();
      router.refresh();
    } finally {
      setConfirming(false);
    }
  }

  function cancel(index: number) {
    setTurns((list) =>
      list.map((t, i) => (i === index ? { ...t, status: 'cancelled', outcome: 'Cancelled. Nothing changed.' } : t)),
    );
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#002838]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex items-center gap-2 p-2"
      >
        <span aria-hidden className="pl-2 text-sm text-[#D3FB52]">
          ✦
        </span>
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          aria-label={clubName ? `Ask about ${clubName}` : 'Ask your pipeline'}
          placeholder={clubName ? `Ask about ${clubName}…` : 'Ask your pipeline…'}
          className="min-w-0 flex-1 bg-transparent py-2 text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="shrink-0 rounded-lg bg-[#D3FB52] px-3 py-1.5 text-sm font-semibold text-[#001820] disabled:opacity-30"
        >
          {busy ? '…' : 'Ask'}
        </button>
      </form>

      {turns.length === 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/[0.06] px-3 py-2.5">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-white/45 hover:border-[#D3FB52]/40 hover:text-white"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto border-t border-white/[0.06] p-3">
          {turns.map((t, i) => (
            <div key={i}>
              {t.role === 'you' ? (
                <p className="text-sm font-medium text-white/50">{t.text}</p>
              ) : (
                <div className="mt-1">
                  {t.text && (
                    <p
                      className={`whitespace-pre-wrap text-sm leading-relaxed ${
                        t.status === 'failed' && !t.proposal ? 'text-red-200' : 'text-white/85'
                      }`}
                    >
                      {t.text}
                    </p>
                  )}

                  {t.proposal && (
                    <div
                      className={`mt-2 rounded-xl border p-3 ${
                        t.status === 'applied'
                          ? 'border-[#D3FB52]/30 bg-[#D3FB52]/[0.06]'
                          : t.status === 'cancelled'
                            ? 'border-white/10 bg-white/[0.02]'
                            : 'border-[#D3FB52]/25 bg-[#001820]'
                      }`}
                    >
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#D3FB52]">
                        {t.status === 'open' ? 'Proposed — nothing has changed yet' : 'Proposed'}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-white">{t.proposal.title}</p>
                      {t.proposal.detail.filter(Boolean).map((d, k) => (
                        <p key={k} className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-white/60">
                          {d}
                        </p>
                      ))}

                      {t.status === 'open' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={confirming}
                            onClick={() => confirm(i)}
                            className="rounded-lg bg-[#D3FB52] px-4 py-1.5 text-sm font-semibold text-[#001820] disabled:opacity-40"
                          >
                            {t.proposal.action === 'draft_email' ? 'Use this draft' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            disabled={confirming}
                            onClick={() => cancel(i)}
                            className="rounded-lg border border-white/15 px-4 py-1.5 text-sm font-medium text-white/60 hover:text-white"
                          >
                            Cancel
                          </button>
                          {t.proposal.action === 'draft_email' && (
                            <span className="self-center text-[11px] text-white/35">
                              Opens the composer. You still preview and send.
                            </span>
                          )}
                        </div>
                      )}

                      {t.outcome && (
                        <p
                          className={`mt-2 text-xs font-medium ${
                            t.status === 'applied'
                              ? 'text-[#D3FB52]'
                              : t.status === 'failed'
                                ? 'text-red-300'
                                : 'text-white/40'
                          }`}
                        >
                          {t.outcome}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {busy && <p className="text-sm text-white/30">Looking…</p>}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}

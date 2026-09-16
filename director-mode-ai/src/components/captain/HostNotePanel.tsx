'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import EmailPreviewModal, { type EmailPreview } from './EmailPreviewModal';

/**
 * Details from the club hosting an away match.
 *
 * The host's email ("warmup courts at 9, all four lines at 9:30, check in at
 * the front desk…") is pasted here or forwarded to the team's address, read
 * into a suggestion, and applied to the match by the captain. Applying fills
 * the fields the lineup email, calendar invite and day-before reminder already
 * print, so there is nothing extra to send — unless the lineup already went
 * out, in which case the lineup's players can be sent the details (preview
 * first, like every CaptainMode send).
 *
 * Inputs set their colour inline: the app's global input CSS wins over
 * Tailwind utilities (see HostEmailPanel).
 */

type Fields = {
  location: string | null;
  arrival_note: string | null;
  opposing_captain_name: string | null;
  opposing_captain_email: string | null;
  opposing_captain_phone: string | null;
};

type Note = {
  id: string;
  source: 'paste' | 'email';
  from_email: string | null;
  subject: string | null;
  created_at: string;
  current?: Fields;
  suggested?: Fields;
  warnings?: string[];
  extracted: { about_a_match: boolean; captains: { name: string; email: string | null }[] };
};

const FIELD_LABELS: [keyof Fields, string][] = [
  ['arrival_note', 'Arrival note (what players read)'],
  ['location', 'Location'],
  ['opposing_captain_name', 'Their captain'],
  ['opposing_captain_email', 'Captain email'],
  ['opposing_captain_phone', 'Captain phone'],
];

const INPUT = { color: '#ffffff', backgroundColor: '#001820' } as const;
const btn = 'px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-50 transition';
const primary = `${btn} bg-[#D3FB52] text-[#001820] hover:brightness-95`;
const ghost = `${btn} border border-white/10 text-white/70 hover:text-white hover:border-white/25`;

export default function HostNotePanel({
  teamId,
  matchId,
  opponent,
  lineupSent,
  hostUpdateSentAt,
}: {
  teamId: string;
  matchId: string;
  opponent: string | null;
  lineupSent: boolean;
  hostUpdateSentAt: string | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [address, setAddress] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Fields>>({});
  const [pasting, setPasting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(hostUpdateSentAt);

  const load = useCallback(async () => {
    const res = await fetch(`/api/captain/host-note?team_id=${teamId}&match_id=${matchId}`);
    if (!res.ok) return;
    const j = (await res.json()) as { notes: Note[]; address: string };
    setNotes(j.notes);
    setAddress(j.address);
    setDrafts((d) => {
      const next = { ...d };
      for (const n of j.notes) if (!next[n.id] && n.suggested) next[n.id] = n.suggested;
      return next;
    });
  }, [teamId, matchId]);

  useEffect(() => {
    load();
  }, [load]);

  const read = async () => {
    setError(null);
    setBusy('read');
    try {
      const res = await fetch('/api/captain/host-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, match_id: matchId, text }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not read that email.');
      setText('');
      setPasting(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const act = async (note: Note, action: 'apply' | 'dismiss') => {
    setError(null);
    setBusy(note.id);
    try {
      const res = await fetch('/api/captain/host-note', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, note_id: note.id, action, match_id: matchId, fields: drafts[note.id] }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not save.');
      if (action === 'apply') setApplied(true);
      await load();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const notify = async (send: boolean) => {
    setError(null);
    setBusy(send ? 'send' : 'preview');
    try {
      const res = await fetch('/api/captain/host-note/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, match_id: matchId, preview: !send }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not build the email.');
      if (send) {
        setPreview(null);
        setSentAt(new Date().toISOString());
      } else {
        setPreview(j as EmailPreview);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setField = (id: string, k: keyof Fields, v: string) =>
    setDrafts((d) => ({ ...d, [id]: { ...(d[id] as Fields), [k]: v } }));

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-white font-semibold">Details from {opponent || 'the host club'}</h3>
          <p className="text-white/40 text-sm mt-0.5">
            Got their &ldquo;looking forward to hosting you&rdquo; email? Paste it and ClubMode puts the
            warm-up, check-in and parking details into your players&apos; lineup email and calendar invite.
          </p>
        </div>
        {!pasting && (
          <button onClick={() => setPasting(true)} className={ghost}>
            Paste their email
          </button>
        )}
      </div>

      {pasting && (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={7}
            placeholder="Paste the whole email here, names and all."
            style={INPUT}
            className="w-full px-3 py-2 rounded-lg border border-white/10 placeholder-white/25 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
          />
          <div className="mt-2 flex gap-2">
            <button onClick={read} disabled={text.trim().length < 20 || !!busy} className={primary}>
              {busy === 'read' ? 'Reading…' : 'Read it'}
            </button>
            <button onClick={() => setPasting(false)} disabled={!!busy} className={ghost}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {notes.map((n) => {
        const draft = drafts[n.id];
        return (
          <div key={n.id} className="mt-4 rounded-lg border border-[#D3FB52]/25 bg-[#001820] p-4">
            <div className="text-xs text-[#D3FB52] uppercase tracking-wide font-semibold">
              {n.source === 'email' ? 'Forwarded email' : 'Pasted email'} · check before applying
            </div>
            {(n.subject || n.from_email) && (
              <div className="text-white/50 text-xs mt-1">
                {n.subject}
                {n.from_email ? ` · from ${n.from_email}` : ''}
              </div>
            )}
            {!n.extracted.about_a_match && (
              <p className="mt-2 text-sm text-amber-200">This doesn&apos;t look like it&apos;s about a match.</p>
            )}
            {(n.warnings ?? []).map((w) => (
              <p key={w} className="mt-2 text-sm text-amber-200">
                ⚠ {w} The match time was not changed. Use &ldquo;Move this match&rdquo; if the host is right.
              </p>
            ))}
            {draft && (
              <div className="mt-3 space-y-3">
                {FIELD_LABELS.map(([k, label]) => {
                  const was = n.current?.[k] ?? null;
                  const now = draft[k] ?? '';
                  return (
                    <label key={k} className="block">
                      <span className="text-white/60 text-xs">{label}</span>
                      {k === 'arrival_note' ? (
                        <textarea
                          value={now}
                          onChange={(e) => setField(n.id, k, e.target.value)}
                          rows={3}
                          style={INPUT}
                          className="mt-1 w-full px-3 py-2 rounded-lg border border-white/10 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                        />
                      ) : (
                        <input
                          value={now}
                          onChange={(e) => setField(n.id, k, e.target.value)}
                          style={INPUT}
                          className="mt-1 w-full px-3 py-2 rounded-lg border border-white/10 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
                        />
                      )}
                      {was && was !== now && <span className="block text-white/30 text-xs mt-0.5">was: {was}</span>}
                    </label>
                  );
                })}
              </div>
            )}
            <div className="mt-3 flex gap-2 flex-wrap">
              <button onClick={() => act(n, 'apply')} disabled={!!busy || !draft} className={primary}>
                {busy === n.id ? 'Saving…' : 'Apply to this match'}
              </button>
              <button onClick={() => act(n, 'dismiss')} disabled={!!busy} className={ghost}>
                Dismiss
              </button>
            </div>
          </div>
        );
      })}

      {applied && !lineupSent && (
        <p className="mt-3 text-sm text-[#D3FB52]">
          Saved. Your players get these details in the lineup email, calendar invite and reminder.
        </p>
      )}

      {lineupSent && (applied || sentAt) && (
        <div className="mt-3 rounded-lg border border-white/10 p-3">
          <p className="text-sm text-white/70">
            {applied
              ? 'The lineup email already went out without these details.'
              : 'Match details were sent to the lineup.'}
            {sentAt ? ` Sent ${new Date(sentAt).toLocaleString()}.` : ''}
          </p>
          <button onClick={() => notify(false)} disabled={!!busy} className={`${ghost} mt-2`}>
            {busy === 'preview' ? 'Building…' : sentAt ? 'Send the details again' : 'Send them to the players in the lineup'}
          </button>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {address && (
        <p className="mt-4 text-xs text-white/40">
          Or forward host emails to{' '}
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(address);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
            className="text-white/70 underline underline-offset-2 hover:text-white"
            title="Copy"
          >
            {address}
          </button>
          {copied ? ' · copied' : ''}. They show up here to check, for whichever match they&apos;re about.
        </p>
      )}

      <EmailPreviewModal
        preview={preview}
        sending={busy === 'send'}
        onSend={() => notify(true)}
        onCancel={() => setPreview(null)}
      />
    </section>
  );
}

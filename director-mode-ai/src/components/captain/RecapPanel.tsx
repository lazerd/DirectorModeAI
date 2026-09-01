'use client';

import { useState } from 'react';
import { Loader2, Send, Eye, Check, Trophy, HeartHandshake, Minus } from 'lucide-react';

/**
 * "Email the team the result" — the recap, from the match page.
 *
 * ALWAYS PREVIEWS FIRST, like every other blast in CaptainMode: the scoreboard
 * is generated from the scores that are SAVED, not the ones still sitting in
 * the form above, so the captain has to see what the team will see before it
 * goes.
 *
 * The tone picks itself. A win pulls the win template, a loss the loss one —
 * nobody writes a cheerful recap after losing, and nobody should have to choose
 * a voice from a dropdown twenty minutes after a match. What the captain edits
 * here is the TEMPLATE, with {opponent} and {score} still in it, so one edit
 * can be saved and reused for the rest of the season.
 *
 * NOTE ON INPUTS: text colour is set inline. This app's global input CSS sits
 * outside Tailwind's layers and wins the cascade, so utility classes alone
 * render form text white-on-white here.
 */

const INPUT: React.CSSProperties = { color: '#ffffff', backgroundColor: '#001820' };

type Outcome = 'win' | 'loss' | 'tie';

type Preview = {
  outcome: Outcome;
  scoreline: string;
  courts_won: number;
  courts_lost: number;
  record: string;
  subject: string;
  html: string;
  sample_for: string | null;
  count: number;
  recipients: { name: string; email: string | null }[];
  already_sent_at: string | null;
  template: {
    subject: string;
    body: string;
    is_default: boolean;
    default_subject: string;
    default_body: string;
  };
};

const TONE: Record<Outcome, { label: string; color: string; icon: typeof Trophy }> = {
  win: { label: 'Win', color: '#D3FB52', icon: Trophy },
  loss: { label: 'Loss', color: '#fca5a5', icon: HeartHandshake },
  tie: { label: 'Tie', color: '#7dd3fc', icon: Minus },
};

export default function RecapPanel({
  matchId,
  hasResults,
  recapSentAt,
}: {
  matchId: string;
  hasResults: boolean;
  recapSentAt: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<string | null>(recapSentAt);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saveTemplate, setSaveTemplate] = useState(true);
  const [edited, setEdited] = useState(false);

  // Nothing to recap until the scores are in the database.
  if (!hasResults) return null;

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/captain/recap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_id: matchId, ...payload }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  };

  const load = async () => {
    setOpen(true);
    setError(null);
    if (preview) return;
    setBusy(true);
    try {
      const j = (await post({ preview: true })) as Preview;
      setSubject(j.template.subject);
      setBody(j.template.body);
      setPreview(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the recap.');
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    setError(null);
    try {
      const j = (await post({ preview: true, subject, body })) as Preview;
      setPreview(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed.');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const j = await post({
        preview: false,
        subject,
        body,
        save_template: saveTemplate && edited,
      });
      setSent(new Date().toISOString());
      setNote(
        `Recap sent to ${j.sent as number} player${j.sent === 1 ? '' : 's'}.` +
          (saveTemplate && edited
            ? ` Saved as your ${TONE[(j.outcome as Outcome) || 'win'].label.toLowerCase()} template.`
            : ''),
      );
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.');
    } finally {
      setSending(false);
    }
  };

  const resetToDefault = () => {
    if (!preview) return;
    setSubject(preview.template.default_subject);
    setBody(preview.template.default_body);
    setEdited(true);
  };

  if (!open) {
    return (
      <div className="mt-5">
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white/80 transition hover:border-[#D3FB52]/50 hover:text-white"
        >
          <Send size={15} />
          {sent ? 'Send the recap again' : 'Email the team the result'}
          {sent && <Check size={14} className="text-emerald-400" />}
        </button>
        {sent && (
          <p className="mt-2 text-xs text-white/35">
            Recap sent{' '}
            {new Date(sent).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}
          </p>
        )}
        {note && <p className="mt-2 text-xs text-[#D3FB52]">{note}</p>}
      </div>
    );
  }

  const tone = preview ? TONE[preview.outcome] : null;
  const ToneIcon = tone?.icon ?? Trophy;

  return (
    <div className="mt-5 rounded-2xl border border-white/[0.08] bg-[#002838] p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-[15px] font-semibold text-white">Match recap</h3>
        {tone && preview && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{ color: tone.color, borderColor: `${tone.color}55`, background: `${tone.color}14` }}
          >
            <ToneIcon size={13} />
            {tone.label} {preview.scoreline} · using your {tone.label.toLowerCase()} template
          </span>
        )}
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-[13px] text-white/40 hover:text-white"
        >
          Close
        </button>
      </div>

      {busy && !preview && (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-white/50">
          <Loader2 size={14} className="animate-spin" /> Building the recap…
        </p>
      )}

      {preview && (
        <>
          <p className="mt-2 text-[13px] text-white/45">
            Built from the scores saved for this match ({preview.courts_won}–{preview.courts_lost} on
            courts). Goes to all {preview.count} players on the roster with an email address.
          </p>

          <label className="mt-4 block">
            <span className="text-xs text-white/45">Subject</span>
            <input
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                setEdited(true);
              }}
              style={INPUT}
              className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
            />
          </label>

          <label className="mt-3 block">
            <span className="text-xs text-white/45">
              Message — the scoreboard, season record and next match are added below it
            </span>
            <textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setEdited(true);
              }}
              rows={8}
              style={INPUT}
              className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm leading-relaxed focus:border-[#D3FB52]/50 focus:outline-none"
            />
          </label>

          <p className="mt-1.5 text-[11px] leading-relaxed text-white/30">
            {'{team}'}, {'{name}'}, {'{opponent}'}, {'{score}'}, {'{record}'}, {'{when}'},{' '}
            {'{home_away}'} get filled in per player. Lines starting with &ldquo;-&rdquo; become
            bullets; blank lines start a new paragraph.{' '}
            <button onClick={resetToDefault} className="underline hover:text-white/60">
              reset to the default wording
            </button>
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={rebuild}
              disabled={busy || sending}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-4 py-2 text-[13.5px] font-medium text-white/80 hover:border-white/30 disabled:opacity-50"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
              Update preview
            </button>
            <button
              onClick={send}
              disabled={sending || busy || !preview.count}
              className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] px-4 py-2 text-[13.5px] font-semibold text-[#001820] disabled:opacity-40"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Send to the team ({preview.count})
            </button>
            {edited && (
              <label className="inline-flex items-center gap-2 text-[12.5px] text-white/50">
                <input
                  type="checkbox"
                  checked={saveTemplate}
                  onChange={(e) => setSaveTemplate(e.target.checked)}
                  className="accent-[#D3FB52]"
                />
                Save this wording as my {tone?.label.toLowerCase()} template
              </label>
            )}
          </div>

          {sent && (
            <p className="mt-3 text-xs text-amber-300/80">
              A recap already went out{' '}
              {new Date(sent).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} — sending
              again mails the whole team a second copy.
            </p>
          )}

          <div className="mt-4">
            <p className="text-xs text-white/45">
              Preview{preview.sample_for ? ` — as ${preview.sample_for} will see it` : ''}
            </p>
            <p className="mt-1 text-[13px] text-white/70">
              <strong className="text-white">Subject:</strong> {preview.subject}
            </p>
            {/* Rendered, not raw: the captain should judge the email, not HTML. */}
            <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-white/10 bg-white p-3">
              <div dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}

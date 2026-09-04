'use client';

/**
 * "Introduce yourself to the league" — one email to every opposing captain.
 *
 * ⚠️ The only bulk send in CaptainMode that leaves the club. Twenty colleagues
 * at rival clubs read it at once and there is no recall, so the flow is
 * deliberately three deliberate steps — write, preview the real thing, send —
 * and the send button never appears until a preview has been rendered.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Users } from 'lucide-react';

type Recipient = {
  opponentId: string;
  opponent: string;
  name: string;
  email: string;
  alreadySentAt: string | null;
};

type Draft = {
  recipients: Recipient[];
  whenText: string;
  courtFormat: number | null;
  defaultSubject: string;
  defaultBody: string;
};

type Preview = {
  subject: string;
  count: number;
  emails: { opponent: string; to: string; subject: string; html: string }[];
};

const INPUT_COLOR = { color: '#ffffff' } as const;
const field =
  'w-full px-3 py-2.5 rounded-xl bg-[#001820] border border-white/10 placeholder-white/25 focus:border-[#D3FB52]/50 focus:outline-none text-sm';

export default function SeasonOpenerPanel({ teamId }: { teamId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resend, setResend] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);

  async function load() {
    setBusy('load');
    setError(null);
    try {
      const res = await fetch(`/api/captain/season-opener?team_id=${teamId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not build the draft.');
        return;
      }
      setDraft(j);
      setSubject(j.defaultSubject || '');
      setBody(j.defaultBody || '');
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  async function doPreview() {
    setBusy('preview');
    setError(null);
    try {
      const res = await fetch('/api/captain/season-opener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, subject, body, resend }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not build the preview.');
        return;
      }
      setPreview(j);
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    setBusy('send');
    setError(null);
    try {
      const res = await fetch('/api/captain/season-opener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, subject, body, resend, send: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error || 'Could not send.');
        return;
      }
      setSent(j.sent ?? 0);
      setPreview(null);
      setDraft(null);
      router.refresh();
    } catch {
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  if (sent !== null) {
    return (
      <p className="mt-3 text-sm text-[#D3FB52]">
        Sent to {sent} {sent === 1 ? 'captain' : 'captains'}.
      </p>
    );
  }

  if (!draft) {
    return (
      <div className="mt-3">
        <button
          onClick={load}
          disabled={busy === 'load'}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-white/70 hover:text-white hover:border-white/25 text-sm disabled:opacity-50"
        >
          <Send size={15} className="text-[#D3FB52]" />
          {busy === 'load' ? 'Building…' : 'Introduce yourself to the league'}
        </button>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </div>
    );
  }

  const fresh = draft.recipients.filter((r) => !r.alreadySentAt);
  const already = draft.recipients.length - fresh.length;
  const going = resend ? draft.recipients : fresh;

  return (
    <div className="mt-3 rounded-2xl border border-white/[0.08] bg-[#002838] p-5 space-y-4">
      <div>
        <h3 className="text-white font-semibold">One note to every opposing captain</h3>
        <p className="text-white/45 text-[13px] mt-1">
          When you play, how many courts you host on, and who to ring — answered once, before the
          season, so nobody has to chase it.
        </p>
      </div>

      {!draft.courtFormat && (
        <p className="text-[13px] text-amber-200/80">
          You haven&rsquo;t set your court format yet, so the email won&rsquo;t mention it. Set it
          under &ldquo;Courts you host on&rdquo; first if you want it in there.
        </p>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-[#001820]/50 p-3">
        <div className="flex items-center gap-2 text-[13px] text-white/70">
          <Users size={14} className="text-[#D3FB52]" />
          {going.length} {going.length === 1 ? 'captain' : 'captains'} across{' '}
          {new Set(going.map((r) => r.opponent)).size} clubs
          {already > 0 && !resend && ` · ${already} already had it`}
        </div>
        <div className="mt-2 max-h-32 overflow-y-auto text-[12px] text-white/40 space-y-0.5">
          {going.map((r) => (
            <div key={r.email}>
              {r.name} · {r.opponent} · {r.email}
            </div>
          ))}
        </div>
        {already > 0 && (
          <label className="mt-2 flex items-center gap-2 text-[12px] text-white/50 cursor-pointer">
            <input
              type="checkbox"
              checked={resend}
              onChange={(e) => {
                setResend(e.target.checked);
                setPreview(null);
              }}
              className="w-3.5 h-3.5 accent-[#D3FB52]"
            />
            Send again to the {already} who already had it
          </label>
        )}
      </div>

      <div>
        <label htmlFor="opener-subject" className="block text-xs text-white/50 mb-1">
          Subject
        </label>
        <input
          id="opener-subject"
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setPreview(null);
          }}
          style={INPUT_COLOR}
          className={field}
        />
      </div>

      <div>
        <label htmlFor="opener-body" className="block text-xs text-white/50 mb-1">
          Message
        </label>
        <textarea
          id="opener-body"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            setPreview(null);
          }}
          rows={12}
          style={INPUT_COLOR}
          className={field}
        />
        <p className="text-[12px] text-white/35 mt-1">
          Leave it as it is and each captain gets their own greeting and their own fixture against
          you. Edit it and everyone gets exactly these words.
        </p>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {preview && (
        <div className="rounded-xl border border-[#D3FB52]/25 bg-[#D3FB52]/[0.04] p-4">
          <p className="text-[#D3FB52] text-sm font-medium">
            This is exactly what {preview.count} {preview.count === 1 ? 'person' : 'people'} will
            receive
          </p>
          <div className="mt-3 space-y-3 max-h-96 overflow-y-auto">
            {preview.emails.map((e) => (
              <div key={e.to} className="rounded-lg bg-white p-3">
                <div className="text-[11px] text-slate-500">
                  To: {e.to} — {e.opponent}
                </div>
                <div className="text-[12px] font-semibold text-slate-800 mt-0.5">{e.subject}</div>
                <div
                  className="mt-2 text-slate-800"
                  dangerouslySetInnerHTML={{ __html: e.html }}
                />
              </div>
            ))}
          </div>
          {preview.count > preview.emails.length && (
            <p className="text-white/40 text-[12px] mt-2">
              …and {preview.count - preview.emails.length} more, the same but addressed to them.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={doPreview}
          disabled={!!busy}
          className="px-5 py-2.5 rounded-xl border border-white/15 text-white/80 hover:text-white text-sm disabled:opacity-50"
        >
          {busy === 'preview' ? 'Building…' : preview ? 'Rebuild preview' : 'Preview'}
        </button>
        {/* Only after a preview has actually been rendered. */}
        {preview && (
          <button
            onClick={send}
            disabled={!!busy}
            className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold text-sm disabled:opacity-50"
          >
            {busy === 'send'
              ? 'Sending…'
              : `Send to ${preview.count} ${preview.count === 1 ? 'captain' : 'captains'}`}
          </button>
        )}
        <button
          onClick={() => {
            setDraft(null);
            setPreview(null);
          }}
          className="px-5 py-2.5 rounded-xl text-white/60 hover:text-white text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

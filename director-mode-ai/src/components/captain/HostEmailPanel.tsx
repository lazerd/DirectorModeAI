'use client';

import { useState } from 'react';
import { Mail, Loader2, Send, Eye, Check, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * "Email the opposing captain" — the hosting note, from the match page.
 *
 * ALWAYS PREVIEWS FIRST. This email leaves the building: it goes to a captain
 * at another club, so there is no undo and no graceful correction. The button
 * renders the exact message and the exact recipient, and only a second,
 * deliberate click sends it.
 *
 * The venue blurb saves back to the team, so the second home match of the
 * season is one tap rather than a retype.
 *
 * NOTE ON INPUTS: text colour is set inline. This app's global input CSS sits
 * outside Tailwind's layers and wins the cascade, so utility classes alone
 * render form text white-on-white here.
 */

const INPUT: React.CSSProperties = {
  color: '#0f172a',
  backgroundColor: '#ffffff',
};

type Preview = {
  to: string;
  subject: string;
  html: string;
  missing_recipient: boolean;
  already_sent_at: string | null;
  defaults: {
    host_notes: string;
    name: string;
    club_name: string;
    line_count: number;
    lines_note: string;
  };
};

export default function HostEmailPanel({
  matchId,
  isHome,
  opponent,
  sentAt,
}: {
  matchId: string;
  isHome: boolean;
  opponent?: string | null;
  sentAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [sent, setSent] = useState<string | null>(sentAt ?? null);

  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  // Editable because the opponent often announces a default before the
  // match, which makes the generated line-count sentence wrong.
  const [linesNote, setLinesNote] = useState('');
  const [loaded, setLoaded] = useState(false);

  // Away matches are somebody else's hosting job.
  if (!isHome) return null;

  const load = async () => {
    setOpen(true);
    if (loaded) return;
    setBusy(true);
    try {
      const res = await fetch('/api/captain/host-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, preview: true }),
      });
      const j = (await res.json()) as Preview & { error?: string };
      if (!res.ok) throw new Error(j.error || 'Could not build the email');
      setTo(j.to || '');
      setName(j.defaults?.name || '');
      setNotes(j.defaults?.host_notes || '');
      setLinesNote(j.defaults?.lines_note ?? '');
      setPreview(j);
      setLoaded(true);
    } catch (e: any) {
      toast.error(e?.message || 'Could not build the email');
    } finally {
      setBusy(false);
    }
  };

  const rebuild = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/captain/host-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId, preview: true, to, name, host_notes: notes, lines_note: linesNote,
        }),
      });
      const j = (await res.json()) as Preview & { error?: string };
      if (!res.ok) throw new Error(j.error || 'Preview failed');
      setPreview(j);
    } catch (e: any) {
      toast.error(e?.message || 'Preview failed');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!to.trim()) { toast.error("Add the opposing captain's email first."); return; }
    setSending(true);
    try {
      const res = await fetch('/api/captain/host-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          match_id: matchId, preview: false, to, name, host_notes: notes,
          lines_note: linesNote, save_notes: true,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Send failed');
      setSent(new Date().toISOString());
      setOpen(false);
      toast.success(`Sent to ${j.sent_to}`);
    } catch (e: any) {
      toast.error(e?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={load}
        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50"
      >
        <Mail size={16} />
        {sent ? 'Email opposing captain again' : 'Email opposing captain'}
        {sent && <Check size={14} className="text-emerald-600" />}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <Mail size={17} className="text-slate-500" />
        <h3 className="text-[15px] font-semibold text-slate-900">
          Hosting note{opponent ? ` — ${opponent}` : ''}
        </h3>
        <button
          onClick={() => setOpen(false)}
          className="ml-auto text-[13px] text-slate-500 hover:text-slate-800"
        >
          Close
        </button>
      </div>

      {sent && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          <Check size={14} /> Already sent {new Date(sent).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[12.5px] font-medium text-slate-600">Their email</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="captain@theirclub.com"
            style={INPUT}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-slate-500"
          />
        </label>
        <label className="block">
          <span className="text-[12.5px] font-medium text-slate-600">Their name (optional)</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane"
            style={INPUT}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] outline-none focus:border-slate-500"
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="text-[12.5px] font-medium text-slate-600">
          Venue notes — saved to the team and reused for every home match
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder={'- Warmup courts 8 and 9 from 9:00am\n- Ice and bottle filling under the deck\n- Ladies restrooms on the ground floor'}
          style={INPUT}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-slate-500"
        />
        <span className="mt-1 block text-[12px] text-slate-500">
          Lines starting with &ldquo;-&rdquo; become bullets. Blank lines start a new paragraph.
        </span>
      </label>

      <label className="mt-3 block">
        <span className="text-[12.5px] font-medium text-slate-600">
          Lines note — clear it to leave this out
        </span>
        <textarea
          value={linesNote}
          onChange={(e) => setLinesNote(e.target.value)}
          rows={3}
          placeholder="We've filled all 4 lines…"
          style={INPUT}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-slate-500"
        />
        <span className="mt-1 block text-[12px] text-slate-500">
          Pre-filled from your court count. Change it if they&rsquo;ve already told you
          they&rsquo;re defaulting a line.
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={rebuild}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-[13.5px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />}
          Update preview
        </button>
        <button
          onClick={send}
          disabled={sending || busy || !to.trim()}
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-[13.5px] font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Send it
        </button>
        {!to.trim() && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] text-amber-700">
            <AlertTriangle size={13} /> Add their email to enable sending
          </span>
        )}
      </div>

      {preview && (
        <div className="mt-4">
          <p className="text-[12.5px] font-medium text-slate-600">
            Preview — this is exactly what {to || 'they'} will receive
          </p>
          <p className="mt-1 text-[13px] text-slate-800">
            <strong>Subject:</strong> {preview.subject}
          </p>
          <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
            {/* Rendered, not raw: the captain should judge the email they are
                about to send, not a blob of HTML. */}
            <div dangerouslySetInnerHTML={{ __html: preview.html }} />
          </div>
        </div>
      )}
    </div>
  );
}

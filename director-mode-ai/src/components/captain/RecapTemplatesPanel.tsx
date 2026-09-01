'use client';

/**
 * The two voices of the post-match recap (three, counting a tie).
 *
 * A recap is the one email where the wording has to change with the result:
 * the win template celebrates, the loss template picks the team up. Which one
 * gets used is decided by the scores, never by a dropdown — so the editing
 * happens here, once, calmly, and match day stays a single tap.
 *
 * Blank fields fall back to the built-in wording, which is written to be
 * sendable as-is. A captain who never opens this panel still sends something
 * that sounds like a person wrote it.
 *
 * NOTE ON INPUTS: text colour is set inline — the app's global input CSS sits
 * outside Tailwind's layers and wins the cascade.
 */

import { useState } from 'react';
import { HeartHandshake, Minus, Trophy } from 'lucide-react';
import { DEFAULT_RECAP, RECAP_OUTCOMES, type RecapOutcome } from '@/lib/captain/recap';

const INPUT: React.CSSProperties = { color: '#ffffff', backgroundColor: '#001820' };

const META: Record<RecapOutcome, { label: string; color: string; blurb: string; icon: typeof Trophy }> = {
  win: {
    label: 'When we win',
    color: '#D3FB52',
    blurb: 'Goes out when we take more courts than they do.',
    icon: Trophy,
  },
  loss: {
    label: 'When we lose',
    color: '#fca5a5',
    blurb: "It's all good, team — we'll get 'em next time.",
    icon: HeartHandshake,
  },
  tie: {
    label: 'When we split',
    color: '#7dd3fc',
    blurb: 'Courts even. Rare, but a win recap would read as a lie.',
    icon: Minus,
  },
};

export type RecapTemplateRow = {
  outcome: RecapOutcome;
  subject: string | null;
  body: string | null;
};

export default function RecapTemplatesPanel({
  teamId,
  initial,
}: {
  teamId: string;
  initial: RecapTemplateRow[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-9">
      <div className="flex flex-wrap items-baseline gap-3">
        <div className="text-xs uppercase tracking-wider text-white/30 font-semibold">
          After the match
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-xs text-white/45 underline hover:text-white"
        >
          {open ? 'Hide the recap wording' : 'Edit the recap wording'}
        </button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-white/45">
        The recap is the one email that goes out after a match, from the match page — the scoreboard,
        the season record and who is next, in your words. The result picks the template, so you never
        send the cheerful one after a loss.
      </p>

      {open && (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {RECAP_OUTCOMES.map((outcome) => (
            <TemplateCard
              key={outcome}
              teamId={teamId}
              outcome={outcome}
              row={initial.find((r) => r.outcome === outcome) || null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  teamId,
  outcome,
  row,
}: {
  teamId: string;
  outcome: RecapOutcome;
  row: RecapTemplateRow | null;
}) {
  const meta = META[outcome];
  const Icon = meta.icon;
  // What is in the database right now, so "unsaved" stays honest after a save.
  const [saved, setSaved] = useState({ subject: row?.subject || '', body: row?.body || '' });
  const [subject, setSubject] = useState(saved.subject);
  const [body, setBody] = useState(saved.body);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const custom = !!(saved.subject || saved.body);
  const dirty = subject !== saved.subject || body !== saved.body;

  async function save(next?: { subject: string; body: string }) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const payload = next ?? { subject, body };
    const res = await fetch('/api/captain/recap', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_id: teamId, outcome, ...payload }),
    });
    setBusy(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || 'Could not save that.');
      return;
    }
    setSaved({ subject: payload.subject.trim(), body: payload.body.trim() });
    setMsg(
      payload.subject.trim() || payload.body.trim()
        ? 'Saved — this is what sends now.'
        : 'Cleared — back to the built-in wording.',
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[#002838] p-4">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: meta.color }} />
        <div className="font-medium" style={{ color: meta.color }}>
          {meta.label}
        </div>
        {custom && <span className="text-[11px] text-white/35">· customised</span>}
      </div>
      <div className="mt-0.5 text-xs text-white/40">{meta.blurb}</div>

      <label className="mt-3 block">
        <span className="text-xs text-white/45">Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={DEFAULT_RECAP[outcome].subject}
          style={INPUT}
          className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none"
        />
      </label>

      <label className="mt-3 block">
        <span className="text-xs text-white/45">Message</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={9}
          placeholder={DEFAULT_RECAP[outcome].body}
          style={INPUT}
          className="mt-1 w-full rounded-lg border border-white/10 px-3 py-2 text-sm leading-relaxed focus:border-[#D3FB52]/50 focus:outline-none"
        />
      </label>

      <p className="mt-1.5 text-[11px] leading-relaxed text-white/30">
        {'{team}'}, {'{name}'}, {'{opponent}'}, {'{score}'}, {'{record}'}, {'{when}'} get filled in
        per player. Leave both blank for the built-in wording.
      </p>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
      {msg && !dirty && <p className="mt-2 text-xs text-[#D3FB52]">{msg}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dirty && (
          <button
            onClick={() => save()}
            disabled={busy}
            className="rounded-lg bg-[#D3FB52] px-3.5 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        )}
        <button
          onClick={() => {
            setSubject(DEFAULT_RECAP[outcome].subject);
            setBody(DEFAULT_RECAP[outcome].body);
          }}
          className="text-xs text-white/40 underline hover:text-white"
        >
          start from the default
        </button>
        {custom && (
          <button
            onClick={() => {
              setSubject('');
              setBody('');
              save({ subject: '', body: '' });
            }}
            disabled={busy}
            className="text-xs text-white/40 underline hover:text-white disabled:opacity-50"
          >
            clear my version
          </button>
        )}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Mail, Loader2, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { datesWithResults, formatPrettyDate } from '@/lib/jttResultsEmail';
import type { JTTMatchup, JTTLine } from '@/app/mixer/leagues/[id]/jtt/page';

type Props = {
  leagueId: string;
  leagueName: string;
  matchups: JTTMatchup[];
  lines: JTTLine[];
  onClose: () => void;
};

type Recipient = { email: string; name: string };

export default function ResultsEmailModal({ leagueId, leagueName, matchups, lines, onClose }: Props) {
  const availableDates = useMemo(
    () => datesWithResults(matchups as any, lines as any),
    [matchups, lines]
  );

  const [date, setDate] = useState(availableDates[0] || '');
  const [note, setNote] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [recipientsTouched, setRecipientsTouched] = useState(false);

  const [loading, setLoading] = useState(false);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // (Re)load the preview whenever the date or note changes.
  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    (async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/jtt/results-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, mode: 'preview', note }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || 'Failed to build preview.');
          setHtml('');
          return;
        }
        setSubject(data.subject || '');
        setHtml(data.html || '');
        if (!recipientsTouched) {
          setRecipientsText(
            (data.defaultRecipients as Recipient[] | undefined)?.map(r => r.email).join(', ') || ''
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to build preview.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // recipientsTouched intentionally omitted: we only want to refetch on date/note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, note, leagueId]);

  const parsedRecipients = useMemo(
    () =>
      recipientsText
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean),
    [recipientsText]
  );

  const saveDefaults = async () => {
    setSavingDefaults(true);
    setSavedNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/jtt/results-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'saveRecipients', recipients: parsedRecipients }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not save the default list.');
        return;
      }
      setSavedNote(`Saved ${data.saved} recipient${data.saved === 1 ? '' : 's'} as the default for this league.`);
      setRecipientsTouched(false);
    } catch (e: any) {
      setError(e?.message || 'Could not save the default list.');
    } finally {
      setSavingDefaults(false);
    }
  };

  const send = async () => {
    if (!date || parsedRecipients.length === 0) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/jtt/results-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, mode: 'send', note, recipients: parsedRecipients }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || data.message || 'Failed to send.');
        return;
      }
      const parts = [`Sent to ${data.sent}`];
      if (data.skipped) parts.push(`${data.skipped} skipped (unsubscribed)`);
      if (data.failed) parts.push(`${data.failed} failed`);
      setResult(parts.join(' · '));
    } catch (e: any) {
      setError(e?.message || 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-stretch sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-4xl sm:rounded-2xl shadow-xl flex flex-col max-h-screen sm:max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-gray-200">
          <Mail size={18} className="text-orange-600" />
          <h2 className="font-semibold text-gray-900 flex-1">Email match results</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        {availableDates.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">
            No completed match results yet. Enter scores on the Matchups tab first.
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row flex-1 min-h-0">
            {/* Controls */}
            <div className="lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-gray-200 p-4 space-y-4 overflow-y-auto">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Match date</label>
                <select
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  style={{ color: '#111827', backgroundColor: '#fff' }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900"
                >
                  {availableDates.map(d => (
                    <option key={d} value={d}>
                      {formatPrettyDate(d)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Recipients ({parsedRecipients.length})
                </label>
                <textarea
                  value={recipientsText}
                  onChange={e => {
                    setRecipientsText(e.target.value);
                    setRecipientsTouched(true);
                  }}
                  rows={4}
                  placeholder="coach1@club.com, coach2@club.com"
                  style={{ color: '#111827', backgroundColor: '#fff' }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono bg-white text-gray-900 placeholder-gray-400"
                />
                <div className="flex items-center justify-between mt-1">
                  <p className="text-[11px] text-gray-400">
                    Comma or line separated. Saved per league + remembered on send.
                  </p>
                  <button
                    onClick={saveDefaults}
                    disabled={savingDefaults || parsedRecipients.length === 0}
                    className="text-[11px] font-medium text-orange-600 hover:text-orange-700 disabled:opacity-40 whitespace-nowrap"
                  >
                    {savingDefaults ? 'Saving…' : 'Save as default'}
                  </button>
                </div>
                {savedNote && (
                  <p className="text-[11px] text-green-600 mt-1">{savedNote}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  placeholder="Great matches today, everyone!"
                  style={{ color: '#111827', backgroundColor: '#fff' }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder-gray-400"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5 text-sm flex items-start gap-2">
                  <AlertCircle size={15} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              {result && (
                <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-2.5 text-sm flex items-start gap-2">
                  <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                  <span>{result}</span>
                </div>
              )}

              <button
                onClick={send}
                disabled={sending || loading || parsedRecipients.length === 0}
                className="w-full inline-flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white font-medium rounded-lg px-4 py-2.5 text-sm"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sending ? 'Sending…' : `Send to ${parsedRecipients.length} coach${parsedRecipients.length === 1 ? '' : 'es'}`}
              </button>
            </div>

            {/* Preview */}
            <div className="flex-1 min-h-0 flex flex-col bg-gray-100">
              <div className="px-4 py-2 text-xs text-gray-500 border-b border-gray-200 bg-white truncate">
                <span className="font-medium text-gray-700">Subject:</span> {subject || '—'}
              </div>
              <div className="flex-1 min-h-0 relative">
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-100/70">
                    <Loader2 size={22} className="animate-spin text-orange-500" />
                  </div>
                )}
                {html ? (
                  <iframe
                    title="Results email preview"
                    srcDoc={html}
                    className="w-full h-full min-h-[400px] bg-white border-0"
                  />
                ) : (
                  !loading && <div className="p-6 text-sm text-gray-400">No preview.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

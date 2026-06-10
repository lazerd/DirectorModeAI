'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Mail, Loader2, Send, CheckCircle2, AlertCircle } from 'lucide-react';

type Props = {
  leagueId: string;
  matchupId: string;
  onClose: () => void;
};

type Recipient = { email: string; name: string };

export default function MatchConfirmEmailModal({ leagueId, matchupId, onClose }: Props) {
  const [note, setNote] = useState('');
  const [recipientsText, setRecipientsText] = useState('');
  const [recipientsTouched, setRecipientsTouched] = useState(false);

  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const base = `/api/leagues/${leagueId}/jtt/matchup/${matchupId}/confirm-email`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    (async () => {
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'preview', note }),
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
        setConfirmedCount(data.confirmedCount ?? null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note, base]);

  const parsedRecipients = useMemo(
    () => recipientsText.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean),
    [recipientsText]
  );

  const send = async () => {
    if (parsedRecipients.length === 0) return;
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'send', note, recipients: parsedRecipients }),
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
      <div className="bg-white w-full sm:max-w-3xl sm:rounded-2xl shadow-xl flex flex-col max-h-screen sm:max-h-[92vh] overflow-hidden">
        <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-gray-200">
          <Mail size={18} className="text-orange-600" />
          <h2 className="font-semibold text-gray-900 flex-1">Email confirmed players</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 min-h-0">
          <div className="lg:w-80 shrink-0 border-b lg:border-b-0 lg:border-r border-gray-200 p-4 space-y-4 overflow-y-auto">
            <p className="text-sm text-gray-600">
              {confirmedCount === null
                ? 'Loading confirmed players…'
                : `${confirmedCount} player${confirmedCount === 1 ? '' : 's'} confirmed (checked in) for this match.`}
            </p>

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
                rows={5}
                placeholder="parent1@email.com, parent2@email.com"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Prefilled from each confirmed player&apos;s parent (or player) email. Comma or line separated.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Note (optional)</label>
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                rows={3}
                placeholder="Wear your team shirt and bring water!"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
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
              {sending ? 'Sending…' : `Send to ${parsedRecipients.length}`}
            </button>
          </div>

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
                  title="Confirmation email preview"
                  srcDoc={html}
                  className="w-full h-full min-h-[400px] bg-white border-0"
                />
              ) : (
                !loading && <div className="p-6 text-sm text-gray-400">No preview.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

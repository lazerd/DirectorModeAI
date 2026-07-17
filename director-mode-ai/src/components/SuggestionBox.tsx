'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Lightbulb, X, Send, Loader2, CheckCircle2 } from 'lucide-react';

// Floating "Suggest a feature" widget for directors. Posts to /api/suggestions.
export default function SuggestionBox() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (message.trim().length < 3) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, page: pathname }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Could not send.');
        return;
      }
      setDone(true);
      setMessage('');
    } catch (e: any) {
      setError(e?.message || 'Could not send.');
    } finally {
      setSending(false);
    }
  };

  const close = () => {
    setOpen(false);
    setTimeout(() => {
      setDone(false);
      setError(null);
    }, 200);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-5 z-40 inline-flex items-center gap-2 bg-yellow-300 text-[#001820] font-semibold rounded-full pl-3 pr-4 py-2.5 shadow-lg hover:bg-yellow-200 transition-colors"
        title="Suggest a feature"
      >
        <Lightbulb size={18} />
        <span className="hidden sm:inline text-sm">Suggest a feature</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-200">
              <Lightbulb size={18} className="text-yellow-500" />
              <h2 className="font-semibold text-gray-900 flex-1">Suggest a feature</h2>
              <button onClick={close} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X size={18} className="text-gray-500" />
              </button>
            </div>

            {done ? (
              <div className="p-8 text-center">
                <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-3" />
                <p className="font-semibold text-gray-900">Thanks — got it!</p>
                <p className="text-sm text-gray-500 mt-1">
                  Your idea went straight to the team. We read every one.
                </p>
                <button
                  onClick={close}
                  className="mt-5 bg-gray-900 text-white rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="p-5">
                <p className="text-sm text-gray-500 mb-3">
                  What would make ClubMode better for your club? Missing feature, annoyance, anything.
                </p>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={5}
                  autoFocus
                  placeholder="I wish ClubMode could…"
                  style={{ color: '#111827', backgroundColor: '#fff' }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder-gray-400"
                />
                {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
                <button
                  onClick={submit}
                  disabled={sending || message.trim().length < 3}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 bg-yellow-300 text-[#001820] disabled:opacity-50 font-semibold rounded-lg px-4 py-2.5 text-sm hover:bg-yellow-200"
                >
                  {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  {sending ? 'Sending…' : 'Send suggestion'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

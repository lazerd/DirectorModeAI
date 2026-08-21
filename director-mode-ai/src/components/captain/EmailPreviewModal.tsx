'use client';

/**
 * Nothing leaves CaptainMode without the captain seeing it first.
 *
 * The body shown here is the real payload the API built — same function, same
 * data — rendered in a sandboxed iframe so the email's own styles can't leak
 * into the app and the app's dark theme can't repaint the email.
 */

import { useEffect, useState } from 'react';

export type EmailPreview = {
  subject: string;
  html: string;
  count: number;
  sample_for?: string;
  recipients: { name: string; email: string | null }[];
};

export default function EmailPreviewModal({
  preview,
  sending,
  onSend,
  onCancel,
}: {
  preview: EmailPreview | null;
  sending: boolean;
  onSend: () => void;
  onCancel: () => void;
}) {
  const [showList, setShowList] = useState(false);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sending) onCancel();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [preview, sending, onCancel]);

  if (!preview) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-6"
      onClick={() => !sending && onCancel()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-[#002838] border border-white/10 overflow-hidden"
      >
        <div className="p-5 border-b border-white/10">
          <div className="text-xs uppercase tracking-wider text-[#D3FB52] font-semibold">
            Preview — nothing has been sent
          </div>
          <h3 className="text-white text-lg font-medium mt-2 leading-snug">{preview.subject}</h3>
          <div className="text-white/50 text-sm mt-2">
            To {preview.count} player{preview.count === 1 ? '' : 's'}
            {preview.sample_for ? ` · showing ${preview.sample_for}'s copy` : ''} ·{' '}
            <button
              onClick={() => setShowList((s) => !s)}
              className="underline hover:text-white"
            >
              {showList ? 'hide list' : 'see who'}
            </button>
          </div>
          {showList && (
            <ul className="mt-3 max-h-32 overflow-y-auto text-xs text-white/60 space-y-1">
              {preview.recipients.map((r) => (
                <li key={r.email || r.name}>
                  {r.name} <span className="text-white/30">{r.email}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-1 overflow-hidden bg-white">
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#fff;color:#0f172a}</style></head><body>${preview.html}</body></html>`}
            className="w-full h-[46vh] sm:h-[52vh] border-0"
          />
        </div>

        <div className="p-4 border-t border-white/10 flex items-center justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={sending}
            className="px-4 py-2.5 rounded-xl text-white/70 hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSend}
            disabled={sending}
            className="px-5 py-2.5 rounded-xl bg-[#D3FB52] text-[#001820] font-semibold disabled:opacity-50"
          >
            {sending
              ? 'Sending…'
              : `Looks right — send to ${preview.count} player${preview.count === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

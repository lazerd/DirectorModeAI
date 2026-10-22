'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CreditCard, Mail, MessageSquare, X } from 'lucide-react';

/**
 * The add-a-card paywall. ClubMode is free to use; a club pays only for what it
 * sends (config/pricing), and adds a card the first time it sends anything.
 *
 * Two surfaces:
 *   - a slim banner while emails are waiting on a card ("4 emails waiting");
 *   - a modal the moment a send gets held. Sends happen from dozens of screens,
 *     so instead of wiring each one, this watches the club's held count after
 *     every write the page makes to /api and opens when it goes up.
 *
 * Renders nothing for guests, for clubs that can send, and on public pages.
 */

type Status = {
  signedIn: boolean;
  enforced?: boolean;
  canSend?: boolean;
  isOwner?: boolean;
  held?: number;
  emailCents?: number;
  textCents?: number;
  checkoutUrl?: string | null;
};

const PUBLIC_PREFIXES = ['/login', '/register', '/pricing', '/join', '/c/', '/q/', '/checkin/', '/demo/', '/try', '/mixermode', '/pulse'];

/** `preview` renders the paywall with a fixed status and no fetching: the owner-only preview page. */
export default function SendPaywall({ preview }: { preview?: Status } = {}) {
  if (preview) return <PaywallView status={preview} initialModal />;
  return <LiveSendPaywall />;
}

function LiveSendPaywall() {
  const pathname = usePathname() || '';
  const [status, setStatus] = useState<Status | null>(null);
  const [modal, setModal] = useState(false);
  const heldRef = useRef(0);

  const onPublicPage = pathname === '/' || pathname === '/c' || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  const refresh = useCallback(async (): Promise<Status | null> => {
    try {
      const res = await fetch('/api/billing/send-status', { cache: 'no-store' });
      const s = (await res.json()) as Status;
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (onPublicPage) return;
    refresh().then((s) => {
      heldRef.current = s?.held ?? 0;
    });
  }, [onPublicPage, pathname, refresh]);

  // Only clubs that can't send need watching; everyone else pays nothing for this.
  const watching = !!status?.signedIn && status.enforced && !status.canSend;

  useEffect(() => {
    if (!watching) return;
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      try {
        const [input, init] = args;
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (method !== 'GET' && url.includes('/api/') && !url.includes('/api/billing/send-status')) {
          // A blocked text says so in the response; a held email shows up as a higher held count.
          const body = await res.clone().text().catch(() => '');
          const s = await refresh();
          if (/Add a card to send|needs_card/.test(body) || (s && (s.held ?? 0) > heldRef.current)) setModal(true);
          heldRef.current = s?.held ?? heldRef.current;
        }
      } catch {
        /* never let the watcher break a request */
      }
      return res;
    };
    return () => {
      window.fetch = original;
    };
  }, [watching, refresh]);

  if (onPublicPage || !watching || !status) return null;
  return <PaywallView status={status} modal={modal} onModal={setModal} />;
}

function PaywallView({
  status,
  modal: modalProp,
  onModal,
  initialModal = false,
}: {
  status: Status;
  modal?: boolean;
  onModal?: (open: boolean) => void;
  initialModal?: boolean;
}) {
  const [ownModal, setOwnModal] = useState(initialModal);
  const modal = modalProp ?? ownModal;
  const setModal = onModal ?? setOwnModal;

  const held = status.held ?? 0;

  const addCard = status.checkoutUrl ? (
    <a
      href={status.checkoutUrl}
      className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#002838] hover:brightness-95"
    >
      <CreditCard className="h-4 w-4" /> Add a card
    </a>
  ) : (
    <span className="text-sm text-slate-300">Ask your club owner to add a card.</span>
  );

  return (
    <>
      {held > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#002838] px-4 py-3 text-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <Mail className="mr-2 inline h-4 w-4 text-[#D3FB52]" />
              {held} {held === 1 ? 'email is' : 'emails are'} waiting to send. Add a card and {held === 1 ? 'it goes' : 'they go'} out right away.
            </p>
            {addCard}
          </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
          <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#002838] p-6 text-white shadow-xl">
            <button
              onClick={() => setModal(false)}
              className="absolute right-4 top-4 text-slate-400 hover:text-white"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
            <h2 className="text-lg font-semibold">Add a card to start sending</h2>
            <p className="mt-2 text-sm text-slate-300">
              ClubMode is free to use. You only pay for what you send. Emails you send now are saved and go out the
              moment a card is on file; texts need the card first.
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-[#D3FB52]" /> Emails: {status.emailCents}¢ each
              </li>
              <li className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-[#D3FB52]" /> Texts: {status.textCents}¢ each
              </li>
            </ul>
            <p className="mt-3 text-xs text-slate-400">Billed monthly for what you send. No subscription.</p>
            <div className="mt-5 flex items-center justify-between gap-3">
              {addCard}
              <button onClick={() => setModal(false)} className="text-sm text-slate-400 hover:text-white">
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

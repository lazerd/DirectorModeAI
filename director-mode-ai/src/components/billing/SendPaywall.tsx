'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { CreditCard, Mail, MessageSquare, X } from 'lucide-react';
import SpendLimitForm from './SpendLimitForm';

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
  /** Card on file, but the club reached the monthly limit its owner set. */
  overLimit?: boolean;
  limitCents?: number | null;
  suggestedLimitUsd?: number;
  freeUsed?: number;
  freeTotal?: number;
  freeRemaining?: number;
  /** No payer yet and the club is past the nudge point of its free emails. */
  nudge?: boolean;
  sponsorCheckoutUrl?: string | null;
  sponsorCapCents?: number;
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

  // Only clubs that can't send, or are running low on free emails, need watching.
  const watching = !!status?.signedIn && status.enforced && (!status.canSend || !!status.nudge);

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
          if (/Add a card to send|needs_card|monthly spending limit|over_limit/.test(body) || (s && (s.held ?? 0) > heldRef.current)) setModal(true);
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
  const cap = Math.round((status.sponsorCapCents ?? 3000) / 100);
  const freeTotal = status.freeTotal ?? 1000;
  const freeUsed = Math.min(status.freeUsed ?? 0, freeTotal);
  const outOfFree = (status.freeRemaining ?? 0) <= 0;
  // Dismissing the nudge hides it until the next step (750, 900, out).
  const nudgeKey = `cm-free-nudge-${outOfFree ? 'out' : freeUsed >= 900 ? 900 : freeUsed >= 750 ? 750 : 500}`;
  const [nudgeHidden, setNudgeHidden] = useState(true);
  useEffect(() => {
    try {
      setNudgeHidden(localStorage.getItem(nudgeKey) === '1');
    } catch {
      setNudgeHidden(false);
    }
  }, [nudgeKey]);
  const hideNudge = () => {
    setNudgeHidden(true);
    try {
      localStorage.setItem(nudgeKey, '1');
    } catch {
      /* fine */
    }
  };
  const sponsorLink = status.sponsorCheckoutUrl ? (
    <a
      href={status.sponsorCheckoutUrl}
      className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#002838] hover:brightness-95"
    >
      <CreditCard className="h-4 w-4" /> Sponsor the club (up to ${cap}/mo)
    </a>
  ) : null;

  const overLimit = !!status.overLimit;
  const limitDollars = status.limitCents == null ? null : Math.round(status.limitCents / 100);

  // Owners act right here; anyone else can sponsor the club, or ask the owner.
  const action = !status.isOwner ? (
    overLimit ? (
      <span className="text-sm text-slate-300">Ask your club owner to raise the monthly limit.</span>
    ) : (
      <div className="space-y-2">
        {sponsorLink}
        <p className="text-xs text-slate-400">
          One member&apos;s card covers the whole club: {status.emailCents}¢ an email, never more than ${cap} a month.
          Cancel anytime. Or ask your club director to add a card.
        </p>
      </div>
    )
  ) : overLimit ? (
    <SpendLimitForm mode="edit" initialDollars={(limitDollars ?? 0) + (status.suggestedLimitUsd ?? 50)} />
  ) : status.checkoutUrl ? (
    <SpendLimitForm mode="add-card" initialDollars={status.suggestedLimitUsd ?? 50} checkoutUrl={status.checkoutUrl} />
  ) : (
    <span className="text-sm text-slate-300">Card setup isn&apos;t available right now.</span>
  );

  return (
    <>
      {held === 0 && status.nudge && !nudgeHidden && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#002838] px-4 py-3 text-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <Mail className="mr-2 inline h-4 w-4 text-[#D3FB52]" />
              {outOfFree
                ? `Your club has used all ${freeTotal.toLocaleString()} free emails.`
                : `Your club has used ${freeUsed.toLocaleString()} of its ${freeTotal.toLocaleString()} free emails.`}{' '}
              Keep it going for no more than ${cap} a month, paid by one member or your director.
            </p>
            <div className="flex items-center gap-3">
              {status.isOwner ? (
                <button
                  onClick={() => setModal(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#002838] hover:brightness-95"
                >
                  <CreditCard className="h-4 w-4" /> Add a card
                </button>
              ) : (
                sponsorLink
              )}
              <button onClick={hideNudge} className="text-slate-400 hover:text-white" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {held > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#002838] px-4 py-3 text-white">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <Mail className="mr-2 inline h-4 w-4 text-[#D3FB52]" />
              {held} {held === 1 ? 'email is' : 'emails are'} waiting to send.{' '}
              {overLimit ? 'Your club reached its monthly spending limit.' : 'They go out as soon as a card is on file.'}
            </p>
            <button
              onClick={() => setModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#002838] hover:brightness-95"
            >
              <CreditCard className="h-4 w-4" /> {overLimit ? 'Raise the limit' : 'Add a card'}
            </button>
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
            {overLimit ? (
              <>
                <h2 className="text-lg font-semibold">Your club reached its monthly limit</h2>
                <p className="mt-2 text-sm text-slate-300">
                  {limitDollars !== null ? `You set $${limitDollars} a month. ` : ''}Emails are saved and go out on the 1st,
                  or right away if you raise the limit. Texts and Ask Claude are paused until then.
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold">
                  {status.isOwner ? 'Add a card to keep sending' : 'Keep your club sending'}
                </h2>
                <p className="mt-2 text-sm text-slate-300">
                  {outOfFree
                    ? `Your club used its ${freeTotal.toLocaleString()} free emails.`
                    : `Your club has ${(status.freeRemaining ?? 0).toLocaleString()} free emails left.`}{' '}
                  After that it&apos;s {status.emailCents}¢ an email, never more than ${cap} a month, paid by your
                  director or one member who sponsors the club. Emails sent now are saved and go out as soon as someone
                  does; texts need a card first.
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  <li className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-[#D3FB52]" /> Emails: {status.emailCents}¢ each
                  </li>
                  <li className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-[#D3FB52]" /> Texts: {status.textCents}¢ each
                  </li>
                </ul>
                <p className="mt-3 text-xs text-slate-400">
                  Billed monthly for what you send. No subscription. Pick a monthly limit so the bill never surprises you.
                </p>
              </>
            )}
            <div className="mt-5">{action}</div>
            <button onClick={() => setModal(false)} className="mt-4 text-sm text-slate-400 hover:text-white">
              Not now
            </button>
          </div>
        </div>
      )}
    </>
  );
}

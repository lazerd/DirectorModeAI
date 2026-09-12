'use client';

/**
 * How the club gets paid.
 *
 * One link, covering class sign-ups and court bookings. A club that already
 * takes cards through its own Square or PayPal pastes that link once here
 * instead of onto every class, and the Pay now button appears on every
 * confirmation page and email.
 *
 * The processor-connection panel says exactly where it stands. A greyed-out
 * "Connect Square" button that does nothing when clicked teaches a customer
 * that the software lies about what it can do, which costs more than the
 * missing feature.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Payments = {
  payment_link: string | null;
  payment_link_label: string | null;
  payment_note: string | null;
  link_on_programs: boolean;
  link_on_courts: boolean;
  provider: 'none' | 'square' | 'stripe';
  provider_status: string;
};

const money = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export default function PaymentSettings() {
  const [payments, setPayments] = useState<Payments | null>(null);
  const [providers, setProviders] = useState({ square: false, stripe: false });
  const [outstanding, setOutstanding] = useState({ programs_cents: 0, courts_cents: 0 });
  const [selling, setSelling] = useState({ courts_unpaid: false, classes_unpaid: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/club-site/payments');
    const j = (await res.json().catch(() => ({}))) as {
      payments?: Payments | null;
      providers?: { square: boolean; stripe: boolean };
      outstanding?: { programs_cents: number; courts_cents: number };
      selling?: { courts_unpaid: boolean; classes_unpaid: boolean };
      error?: string;
    };
    if (!res.ok) setError(j.error || 'Could not load your payment settings.');
    else {
      setPayments(
        j.payments ?? {
          payment_link: null,
          payment_link_label: null,
          payment_note: null,
          link_on_programs: true,
          link_on_courts: true,
          provider: 'none',
          provider_status: 'disconnected',
        },
      );
      if (j.providers) setProviders(j.providers);
      if (j.outstanding) setOutstanding(j.outstanding);
      if (j.selling) setSelling(j.selling);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/club-site/payments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; payments?: Payments };
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return;
      }
      if (j.payments) setPayments(j.payments);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-white/40">Loading…</p>;
  if (!payments) return <p className="text-red-300">{error || 'Could not load.'}</p>;

  const field =
    'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none';
  const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';
  const hasLink = !!payments.payment_link;
  const owed = outstanding.programs_cents + outstanding.courts_cents;

  /*
   * The gap that is invisible from both ends.
   *
   * A club sets a $24 public court rate, never pastes a link, and every
   * confirmation quietly reads "settle up at the desk" — so the club believes
   * it is selling court time online while actually taking unpaid
   * reservations. The customer is not misled; the CLUB is. Said before
   * anything else on the page, because no other setting here matters until it
   * is fixed.
   */
  const unpaid: string[] = [];
  if (selling.courts_unpaid) unpaid.push('court time');
  if (selling.classes_unpaid) unpaid.push('classes');

  return (
    <div className="space-y-8">
      {/* ------------------------------------------- selling with no checkout */}
      {unpaid.length > 0 && (
        <div className="rounded-2xl border border-red-400/40 bg-red-400/[0.08] p-4">
          <div className="font-semibold text-red-200">
            You are charging for {unpaid.join(' and ')} with no way to take the money
          </div>
          <div className="mt-1 text-sm text-red-100/75">
            Every booking and sign-up currently says <em>settle up at the desk</em>, so people
            reserve without paying. Paste your Square, PayPal or Venmo link below and they each get
            a <strong>Pay now</strong> button instead — on the confirmation page and in the email.
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- what's owed */}
      {owed > 0 && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-400/[0.07] p-4">
          <div className="font-semibold text-amber-200">{money(owed)} outstanding</div>
          <div className="mt-0.5 text-sm text-amber-100/70">
            {money(outstanding.programs_cents)} from class sign-ups,{' '}
            {money(outstanding.courts_cents)} from court bookings.{' '}
            {hasLink
              ? 'Everyone has a Pay now button; mark them paid as the money lands.'
              : 'Add a payment link below and they all get a Pay now button.'}
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------ the link */}
      <section>
        <h2 className="font-display text-xl text-white">Your payment link</h2>
        <p className="mt-1 text-sm text-white/50">
          Paste the checkout you already use — Square, Stripe, PayPal, Venmo, anything with an
          https link. We put a <strong>Pay now</strong> button on every confirmation page and email.
          The money goes straight to you; we never touch it.
        </p>

        <div className="mt-4 grid gap-4">
          <div>
            <label className={labelCls} htmlFor="payment_link">
              Checkout link
            </label>
            <input
              id="payment_link"
              defaultValue={payments.payment_link ?? ''}
              placeholder="https://square.link/u/…"
              onBlur={(e) => {
                if (e.target.value.trim() === (payments.payment_link ?? '')) return;
                save({ payment_link: e.target.value });
              }}
              style={{ color: '#ffffff' }}
              className={field}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="payment_link_label">
                What the button says
              </label>
              <input
                id="payment_link_label"
                defaultValue={payments.payment_link_label ?? ''}
                placeholder="Pay now"
                onBlur={(e) => {
                  if (e.target.value.trim() === (payments.payment_link_label ?? '')) return;
                  save({ payment_link_label: e.target.value });
                }}
                style={{ color: '#ffffff' }}
                className={field}
              />
              <p className="mt-1 text-xs text-white/35">
                A Venmo link should not say &ldquo;Pay by card&rdquo;.
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="payment_note">
                A line under the button
              </label>
              <input
                id="payment_note"
                defaultValue={payments.payment_note ?? ''}
                placeholder="Pay within 48 hours to keep your spot."
                onBlur={(e) => {
                  if (e.target.value.trim() === (payments.payment_note ?? '')) return;
                  save({ payment_note: e.target.value });
                }}
                style={{ color: '#ffffff' }}
                className={field}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-5">
            {(
              [
                ['link_on_programs', 'Show it on class sign-ups'],
                ['link_on_courts', 'Show it on court bookings'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={payments[key]}
                  disabled={busy}
                  onChange={(e) => save({ [key]: e.target.checked })}
                />
                <span className="text-white/75">{label}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        {saved && <p className="mt-3 text-sm text-[#D3FB52]">Saved.</p>}

        <div
          className={`mt-5 rounded-xl border p-4 text-sm ${
            hasLink
              ? 'border-[#D3FB52]/30 bg-[#D3FB52]/[0.06] text-white/80'
              : 'border-white/10 bg-[#002838] text-white/60'
          }`}
        >
          {hasLink ? (
            <>
              <strong className="text-white">People can pay you online.</strong> Anyone who owes
              money sees your button and you click <em>Mark paid</em> when it lands. A class with
              its own link keeps that one.
            </>
          ) : (
            <>
              <strong className="text-white">Right now money is collected in person.</strong>{' '}
              Bookings and sign-ups record what is owed and say to settle up at the club. Paste a
              link above and that changes everywhere at once.
            </>
          )}
        </div>
      </section>

      {/* -------------------------------------------------- the processor slot */}
      <section>
        <h2 className="font-display text-xl text-white">Card payments inside ClubMode</h2>
        <p className="mt-1 text-sm text-white/50">
          Connecting your own Square or Stripe would let someone pay without leaving your site, and
          let us mark it paid for you automatically.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(
            [
              ['square', 'Square', providers.square],
              ['stripe', 'Stripe', providers.stripe],
            ] as const
          ).map(([key, name, available]) => (
            <div
              key={key}
              className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4"
            >
              <div className="font-semibold text-white">{name}</div>
              {payments.provider === key && payments.provider_status === 'connected' ? (
                <p className="mt-1 text-sm text-[#D3FB52]">Connected.</p>
              ) : available ? (
                <a
                  href={`/api/club-site/payments/connect/${key}`}
                  className="mt-3 inline-block rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820]"
                >
                  Connect {name}
                </a>
              ) : (
                /*
                 * No OAuth app configured, so there is nothing to click. Says
                 * so instead of rendering a dead button — a control that does
                 * nothing teaches a customer that the software lies.
                 */
                <p className="mt-1 text-sm text-white/45">
                  Not available yet. This is the next thing we build, and it needs your {name}{' '}
                  login rather than any change here.
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap gap-4 border-t border-white/[0.06] pt-6 text-sm">
        <Link href="/run/site" className="text-white/50 hover:text-white">
          ← Club site
        </Link>
        <Link href="/run/site/bookings" className="text-white/50 hover:text-white">
          Court bookings →
        </Link>
        <Link href="/run/site/classes" className="text-white/50 hover:text-white">
          Classes →
        </Link>
      </div>
    </div>
  );
}

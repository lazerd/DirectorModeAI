'use client';

import { useMemo, useState } from 'react';
import { Loader2, AlertCircle, Tag, CheckCircle2 } from 'lucide-react';
import {
  ageOnDate,
  isEligibleForDivision,
  PLAYERS_PER_QUAD,
  type QuadDivision,
} from '@/lib/quadDivisions';

export type DivisionOption = QuadDivision & {
  /** How many players are already in line for this division. */
  inLine: number;
};

type Props = {
  slug: string;
  feeCents: number;
  ageMax: number | null;
  genderRestriction: 'boys' | 'girls' | 'coed' | null;
  /** Sponsor accent for the submit button (defaults to CoachMode orange). */
  accent?: string;
  /** Overrides the button label. Takes a node so it can be two lines. */
  submitLabel?: React.ReactNode;
  /** Age divisions to choose between. Empty = single-division event. */
  divisions?: DivisionOption[];
  /** ISO date of the event — divisions are judged on the player's age that day. */
  eventDate?: string | null;
  /** True when nobody pays at signup; the director invites and then bills. */
  requestMode?: boolean;
};

// Tailwind text colors on inputs get clobbered by the global input reset in
// this app — set the colors inline so fields never render white-on-white.
const INPUT_STYLE = { color: '#111827', backgroundColor: '#FFFFFF' } as const;

export default function RegisterForm({
  slug,
  feeCents,
  ageMax,
  genderRestriction,
  accent,
  submitLabel,
  divisions = [],
  eventDate,
  requestMode = false,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [couponState, setCouponState] = useState<
    | { status: 'idle' }
    | { status: 'checking' }
    | { status: 'ok'; label: string | null; discountPercent: number; amountDueCents: number }
    | { status: 'bad'; reason: string }
  >({ status: 'idle' });
  const [form, setForm] = useState({
    player_name: '',
    player_email: '',
    player_phone: '',
    parent_name: '',
    parent_email: '',
    parent_phone: '',
    date_of_birth: '',
    division: '',
    coupon_code: '',
    gender:
      genderRestriction === 'boys'
        ? 'male'
        : genderRestriction === 'girls'
          ? 'female'
          : '',
    ntrp: '',
  });

  const hasDivisions = divisions.length > 0;

  // Age on the day of the event decides which divisions are open to a player.
  const age = useMemo(() => {
    if (!form.date_of_birth || !eventDate) return null;
    const dob = new Date(form.date_of_birth + 'T00:00:00');
    const on = new Date(eventDate + 'T00:00:00');
    if (Number.isNaN(dob.getTime()) || Number.isNaN(on.getTime())) return null;
    return ageOnDate(dob, on);
  }, [form.date_of_birth, eventDate]);

  const divisionState = divisions.map((d) => ({
    ...d,
    eligible: age === null ? true : isEligibleForDivision(age, d),
  }));
  const noneEligible = age !== null && divisionState.every((d) => !d.eligible);

  // A birthday change can invalidate an already-picked division.
  const selectedStillOk =
    !form.division || divisionState.find((d) => d.id === form.division)?.eligible !== false;
  const effectiveDivision = selectedStillOk ? form.division : '';

  const checkCoupon = async () => {
    const code = form.coupon_code.trim();
    if (!code) {
      setCouponState({ status: 'idle' });
      return;
    }
    setCouponState({ status: 'checking' });
    try {
      const res = await fetch(
        `/api/quads/coupon?slug=${encodeURIComponent(slug)}&code=${encodeURIComponent(code)}`
      );
      const data = await res.json();
      if (data.valid) {
        setCouponState({
          status: 'ok',
          label: data.label ?? null,
          discountPercent: data.discount_percent,
          amountDueCents: data.amount_due_cents,
        });
      } else {
        setCouponState({ status: 'bad', reason: data.reason || "That code isn't recognized." });
      }
    } catch {
      setCouponState({ status: 'bad', reason: 'Could not check that code — try again.' });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/quads/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          ...form,
          division: effectiveDivision || null,
          ntrp: form.ntrp ? parseFloat(form.ntrp) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Registration failed.');
        setSubmitting(false);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
        return;
      }
      // Free event, request-only signup, or payment collected off-platform.
      window.location.href = `/quads/${slug}/registered?entry=${data.entry_id}`;
    } catch (err: any) {
      setError(err?.message || 'Network error');
      setSubmitting(false);
    }
  };

  const isJunior = !!ageMax && ageMax <= 18;
  const buttonLabel = submitLabel
    ? submitLabel
    : requestMode
      ? 'Request a spot'
      : feeCents > 0
        ? `Register & Pay $${(feeCents / 100).toFixed(0)}`
        : 'Register (Free)';

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Player Name *</label>
          <input
            type="text"
            required
            value={form.player_name}
            onChange={(e) => setForm({ ...form, player_name: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            style={INPUT_STYLE}
            placeholder="Full name"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Date of Birth {hasDivisions && '*'}
          </label>
          <input
            type="date"
            value={form.date_of_birth}
            onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            style={INPUT_STYLE}
            required={!!ageMax || hasDivisions}
          />
          {age !== null && <p className="text-xs text-gray-500 mt-1">Age {age} on event day.</p>}
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Gender</label>
          <select
            value={form.gender}
            onChange={(e) => setForm({ ...form, gender: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            style={INPUT_STYLE}
            disabled={genderRestriction === 'boys' || genderRestriction === 'girls'}
            required={genderRestriction === 'boys' || genderRestriction === 'girls'}
          >
            <option value="">— select —</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="nonbinary">Non-binary</option>
          </select>
        </div>

        {hasDivisions && (
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Division *</label>
            {!form.date_of_birth ? (
              <p className="text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg px-3 py-3">
                Enter a date of birth to see which divisions this player can enter.
              </p>
            ) : noneEligible ? (
              <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-3 flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                Age {age} doesn&rsquo;t fit any division on this date. Email us and we&rsquo;ll sort
                it out.
              </p>
            ) : (
              <div className="space-y-2">
                {divisionState.map((d) => {
                  const full = d.inLine >= PLAYERS_PER_QUAD;
                  const selected = effectiveDivision === d.id;
                  return (
                    <label
                      key={d.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selected
                          ? 'border-2'
                          : d.eligible
                            ? 'border-gray-300 hover:bg-gray-50'
                            : 'border-gray-200 opacity-45 cursor-not-allowed'
                      }`}
                      style={selected ? { borderColor: accent || '#F97316' } : undefined}
                    >
                      <input
                        type="radio"
                        name="division"
                        value={d.id}
                        checked={selected}
                        disabled={!d.eligible}
                        onChange={(e) => setForm({ ...form, division: e.target.value })}
                        required
                      />
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-gray-900">{d.label}</span>
                        <span className="block text-xs text-gray-500">
                          {!d.eligible
                            ? 'Not eligible at this age'
                            : full
                              ? `${d.inLine} in line — you'd join the waitlist`
                              : `${PLAYERS_PER_QUAD - d.inLine} of ${PLAYERS_PER_QUAD} spots left`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Player Email</label>
          <input
            type="email"
            value={form.player_email}
            onChange={(e) => setForm({ ...form, player_email: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            style={INPUT_STYLE}
            required={!isJunior}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Player Phone</label>
          <input
            type="tel"
            value={form.player_phone}
            onChange={(e) => setForm({ ...form, player_phone: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            style={INPUT_STYLE}
          />
        </div>

        {isJunior && (
          <>
            <div className="sm:col-span-2 pt-2 border-t border-gray-200">
              <p className="text-xs text-gray-600 font-medium">
                Parent / Guardian (required for juniors — the payment link goes here)
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Name *</label>
              <input
                type="text"
                required={isJunior}
                value={form.parent_name}
                onChange={(e) => setForm({ ...form, parent_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900"
                style={INPUT_STYLE}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Email *</label>
              <input
                type="email"
                required={isJunior}
                value={form.parent_email}
                onChange={(e) => setForm({ ...form, parent_email: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900"
                style={INPUT_STYLE}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">Parent Phone</label>
              <input
                type="tel"
                value={form.parent_phone}
                onChange={(e) => setForm({ ...form, parent_phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg text-gray-900"
                style={INPUT_STYLE}
              />
            </div>
          </>
        )}

        {feeCents > 0 && (
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Comp code (optional)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <input
                  type="text"
                  value={form.coupon_code}
                  onChange={(e) => {
                    setForm({ ...form, coupon_code: e.target.value.toUpperCase() });
                    setCouponState({ status: 'idle' });
                  }}
                  onBlur={checkCoupon}
                  className="w-full pl-9 pr-3 py-2 border rounded-lg text-gray-900 uppercase tracking-wide"
                  style={INPUT_STYLE}
                  placeholder="Have a code?"
                  maxLength={40}
                />
              </div>
              <button
                type="button"
                onClick={checkCoupon}
                disabled={!form.coupon_code.trim() || couponState.status === 'checking'}
                className="px-4 py-2 border rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              >
                {couponState.status === 'checking' ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  'Apply'
                )}
              </button>
            </div>
            {couponState.status === 'ok' && (
              <p className="text-xs mt-1.5 flex items-center gap-1.5 font-semibold text-emerald-700">
                <CheckCircle2 size={13} />
                {couponState.discountPercent === 100
                  ? 'Free entry applied'
                  : `${couponState.discountPercent}% off — $${(couponState.amountDueCents / 100).toFixed(0)} due`}
                {couponState.label ? ` · ${couponState.label}` : ''}
              </p>
            )}
            {couponState.status === 'bad' && (
              <p className="text-xs mt-1.5 flex items-center gap-1.5 text-red-600">
                <AlertCircle size={13} />
                {couponState.reason}
              </p>
            )}
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            NTRP (optional — UTR auto-looked up)
          </label>
          <input
            type="number"
            min="1"
            max="7"
            step="0.5"
            value={form.ntrp}
            onChange={(e) => setForm({ ...form, ntrp: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg text-gray-900"
            style={INPUT_STYLE}
            placeholder="e.g. 3.5"
          />
          <p className="text-xs text-gray-500 mt-1">
            We&rsquo;ll look up the player&rsquo;s UTR by name automatically. NTRP is a backup if
            UTR isn&rsquo;t found — it only affects who they get grouped with.
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || (hasDivisions && !effectiveDivision)}
        className="w-full py-3 text-white rounded-lg font-semibold disabled:opacity-50 flex items-center justify-center gap-2 transition-opacity hover:opacity-90"
        style={{ backgroundColor: accent || '#F97316' }}
      >
        {submitting && <Loader2 size={16} className="animate-spin" />}
        {submitting ? 'Working…' : buttonLabel}
      </button>

      {requestMode && (
        <p className="text-xs text-center text-gray-500">
          {couponState.status === 'ok' && couponState.discountPercent === 100
            ? "No payment now or later — your code covers the entry. You'll get a confirmation once the division is set."
            : 'No payment now. Accepted players get a payment link and 24 hours to confirm.'}
        </p>
      )}
    </form>
  );
}

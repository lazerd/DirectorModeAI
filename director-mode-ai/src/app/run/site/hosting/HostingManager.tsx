'use client';

/**
 * Hosting: the packages, and the teams waiting on an answer.
 *
 * Requests lead, because a team waiting three days for a reply books somewhere
 * else. Each one shows the day they want and the money, so the decision can be
 * made against the season calendar without leaving the screen.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type Pkg = {
  id: string;
  label: string;
  courts: number;
  matches_included: number;
  price_cents: number;
  playoff_price_cents: number | null;
  blurb: string | null;
  includes: string[] | null;
  active: boolean;
  display_order: number;
};

type Req = {
  id: string;
  team_name: string;
  league: string | null;
  division: string | null;
  captain_name: string;
  captain_email: string;
  captain_phone: string | null;
  preferred_day: string | null;
  preferred_time: string | null;
  season_note: string | null;
  expected_playoffs: number;
  quoted_label: string | null;
  quoted_courts: number | null;
  quoted_matches: number | null;
  quoted_cents: number | null;
  quoted_playoff_cents: number | null;
  status: 'requested' | 'approved' | 'declined' | 'paid' | 'cancelled';
  staff_note: string | null;
  created_at: string;
};

const money = (cents: number | null) =>
  cents == null ? '—' : cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export default function HostingManager() {
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [requests, setRequests] = useState<Req[]>([]);
  const [club, setClub] = useState<{ slug: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/club-site/hosting');
    const j = (await res.json().catch(() => ({}))) as {
      packages?: Pkg[];
      requests?: Req[];
      club?: { slug: string; name: string };
      error?: string;
    };
    if (!res.ok) setError(j.error || 'Could not load hosting.');
    else {
      setPackages(j.packages ?? []);
      setRequests(j.requests ?? []);
      setClub(j.club ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function send(body: Record<string, unknown>, method: 'POST' | 'PATCH' | 'DELETE' = 'PATCH') {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const url =
        method === 'DELETE'
          ? `/api/club-site/hosting?package_id=${encodeURIComponent(String(body.package_id))}`
          : '/api/club-site/hosting';
      const res = await fetch(url, {
        method,
        ...(method === 'DELETE'
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        emailed?: boolean;
        status?: string;
      };
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return;
      }
      if (j.message) setMsg(j.message);
      else if (j.status === 'approved') {
        setMsg(
          j.emailed
            ? 'Approved — the captain has been emailed with how to pay.'
            : 'Approved, but the email could not be sent. Let them know yourself.',
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-white/40">Loading…</p>;

  const waiting = requests.filter((r) => r.status === 'requested');
  const decided = requests.filter((r) => r.status !== 'requested');

  const field =
    'rounded-lg border border-white/10 bg-[#001820] px-2.5 py-1.5 text-sm focus:border-[#D3FB52]/50 focus:outline-none';
  const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

  const RequestCard = ({ r }: { r: Req }) => {
    const total = (r.quoted_cents ?? 0) + (r.quoted_playoff_cents ?? 0) * (r.expected_playoffs ?? 0);
    return (
      <div
        className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4"
        style={r.status === 'declined' || r.status === 'cancelled' ? { opacity: 0.55 } : undefined}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-white">
              {r.team_name}
              {r.status !== 'requested' && (
                <span
                  className={`ml-2 text-xs font-normal ${
                    r.status === 'approved' || r.status === 'paid'
                      ? 'text-[#D3FB52]'
                      : 'text-white/40'
                  }`}
                >
                  {r.status}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-sm text-white/45">
              {r.league || 'League not given'}
              {r.division ? ` · ${r.division}` : ''}
            </div>
            <div className="mt-1 text-sm text-white/60">
              {r.captain_name} · {r.captain_email}
              {r.captain_phone ? ` · ${r.captain_phone}` : ''}
            </div>
            {/* The thing to check against the season before saying yes. */}
            <div className="mt-2 text-sm">
              <span className="text-white/40">Wants </span>
              <span className="font-medium text-white">
                {r.preferred_day || 'no day given'}
                {r.preferred_time ? `, ${r.preferred_time}` : ''}
              </span>
              <span className="text-white/40">
                {' '}
                · {r.quoted_courts} courts × {r.quoted_matches} matches
              </span>
            </div>
            {r.season_note && (
              <div className="mt-1 text-xs italic text-white/35">“{r.season_note}”</div>
            )}
            {r.staff_note && (
              <div className="mt-1 text-xs text-white/45">Your note: {r.staff_note}</div>
            )}
          </div>

          <div className="shrink-0 text-right">
            <div className="text-lg font-bold text-white">{money(total)}</div>
            <div className="text-xs text-white/40">
              {money(r.quoted_cents)} season
              {r.expected_playoffs > 0
                ? ` + ${r.expected_playoffs} × ${money(r.quoted_playoff_cents)}`
                : ''}
            </div>
          </div>
        </div>

        {r.status === 'requested' && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const note = window.prompt(
                  'Anything to tell them? (optional — goes in the confirmation email)',
                  '',
                );
                if (note === null) return;
                send({ request_id: r.id, status: 'approved', staff_note: note });
              }}
              className="rounded-lg bg-[#D3FB52] px-4 py-2 text-sm font-semibold text-[#001820] disabled:opacity-50"
            >
              Approve &amp; email them
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const note = window.prompt('Why? (kept on file, not emailed)', '');
                if (note === null) return;
                send({ request_id: r.id, status: 'declined', staff_note: note });
              }}
              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-50"
            >
              Decline
            </button>
            <a
              href="/calendar"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-white/45 hover:text-white"
            >
              Check the season first ↗
            </a>
          </div>
        )}

        {r.status === 'approved' && (
          <div className="mt-3 border-t border-white/[0.06] pt-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => send({ request_id: r.id, status: 'paid' })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 hover:text-white disabled:opacity-50"
            >
              Mark paid
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-10">
      {error && <p className="text-sm text-red-300">{error}</p>}
      {msg && <p className="text-sm text-[#D3FB52]">{msg}</p>}

      {/* ------------------------------------------------------- requests */}
      <section>
        <h2 className="font-display text-xl text-white">
          Teams asking to host{' '}
          {waiting.length > 0 && (
            <span className="ml-1 rounded-full bg-[#D3FB52] px-2 py-0.5 text-xs font-bold text-[#001820]">
              {waiting.length} waiting
            </span>
          )}
        </h2>
        {requests.length === 0 ? (
          <p className="mt-3 text-sm text-white/45">
            No requests yet. Teams find this through your{' '}
            {club && (
              <a
                href={`/c/${club.slug}/host`}
                target="_blank"
                rel="noreferrer"
                className="text-white/70 hover:underline"
              >
                hosting page
              </a>
            )}
            .
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {waiting.map((r) => (
              <RequestCard key={r.id} r={r} />
            ))}
            {decided.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-xs text-white/35">
                  {decided.length} already decided
                </summary>
                <div className="mt-3 space-y-3">
                  {decided.map((r) => (
                    <RequestCard key={r.id} r={r} />
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- packages */}
      <section>
        <h2 className="font-display text-xl text-white">What you sell</h2>
        <p className="mt-1 text-sm text-white/45">
          The price per match is worked out for you — it is the number a captain compares against
          what they pay now.
        </p>

        <div className="mt-4 space-y-3">
          {packages.map((p) => {
            const perMatch = p.matches_included > 0 ? p.price_cents / p.matches_included : 0;
            const playoffPremium =
              p.playoff_price_cents != null && perMatch > 0
                ? p.playoff_price_cents - perMatch
                : null;
            return (
              <div
                key={p.id}
                className="rounded-2xl border border-white/[0.08] bg-[#002838] p-4"
                style={p.active ? undefined : { opacity: 0.55 }}
              >
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className={labelCls}>Name</label>
                    <input
                      defaultValue={p.label}
                      onBlur={(e) =>
                        e.target.value !== p.label &&
                        send({ package_id: p.id, label: e.target.value })
                      }
                      style={{ color: '#ffffff' }}
                      className={`${field} w-40`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Courts</label>
                    <input
                      inputMode="numeric"
                      defaultValue={String(p.courts)}
                      onBlur={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n) && n > 0 && n !== p.courts)
                          send({ package_id: p.id, courts: n });
                      }}
                      style={{ color: '#ffffff' }}
                      className={`${field} w-16`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Home matches</label>
                    <input
                      inputMode="numeric"
                      defaultValue={String(p.matches_included)}
                      onBlur={(e) => {
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n) && n > 0 && n !== p.matches_included)
                          send({ package_id: p.id, matches_included: n });
                      }}
                      style={{ color: '#ffffff' }}
                      className={`${field} w-20`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Season fee</label>
                    <div className="flex items-center gap-1">
                      <span className="text-white/40">$</span>
                      <input
                        inputMode="decimal"
                        defaultValue={String(p.price_cents / 100)}
                        onBlur={(e) => {
                          const c = Math.round(parseFloat(e.target.value) * 100);
                          if (Number.isFinite(c) && c >= 0 && c !== p.price_cents)
                            send({ package_id: p.id, price_cents: c });
                        }}
                        style={{ color: '#ffffff' }}
                        className={`${field} w-24`}
                      />
                    </div>
                  </div>
                  <div>
                    <label className={labelCls}>Playoff / match</label>
                    <div className="flex items-center gap-1">
                      <span className="text-white/40">$</span>
                      <input
                        inputMode="decimal"
                        defaultValue={
                          p.playoff_price_cents == null ? '' : String(p.playoff_price_cents / 100)
                        }
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const c = raw === '' ? null : Math.round(parseFloat(raw) * 100);
                          if (c !== null && !Number.isFinite(c)) return;
                          if (c !== p.playoff_price_cents)
                            send({ package_id: p.id, playoff_price_cents: c });
                        }}
                        style={{ color: '#ffffff' }}
                        className={`${field} w-24`}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-white/60">
                    <strong className="text-white">{money(Math.round(perMatch))}</strong> a match
                  </span>
                  {/*
                    The check I would otherwise have to do by hand every time.
                    A playoff priced BELOW the season rate means a team pays
                    less for a playoff than a regular match, which reads as an
                    error to anyone who does the division.
                  */}
                  {playoffPremium !== null && playoffPremium < 0 && (
                    <span className="text-amber-300">
                      Playoffs are {money(Math.abs(Math.round(playoffPremium)))} CHEAPER than a
                      regular match — teams will notice
                    </span>
                  )}
                  {playoffPremium !== null && playoffPremium === 0 && (
                    <span className="text-amber-300/80">
                      Playoffs cost the same as a regular match
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => send({ package_id: p.id, active: !p.active })}
                    className="text-xs font-medium text-white/45 hover:text-white disabled:opacity-50"
                  >
                    {p.active ? 'Take off my page' : 'Put back on my page'}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(`Delete "${p.label}"?`)) return;
                      send({ package_id: p.id }, 'DELETE');
                    }}
                    className="text-xs text-white/30 hover:text-red-300 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>

                <div className="mt-3">
                  <label className={labelCls}>Description on your page</label>
                  <input
                    defaultValue={p.blurb ?? ''}
                    placeholder="What the fee covers…"
                    onBlur={(e) =>
                      e.target.value !== (p.blurb ?? '') &&
                      send({ package_id: p.id, blurb: e.target.value })
                    }
                    style={{ color: '#ffffff' }}
                    className={`${field} w-full`}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            send(
              {
                label: 'New package',
                courts: 3,
                matches_included: 5,
                price_cents: 50000,
                playoff_price_cents: 10000,
              },
              'POST',
            )
          }
          className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-50"
        >
          Add a package
        </button>
      </section>

      <div className="flex flex-wrap gap-4 border-t border-white/[0.06] pt-6 text-sm">
        <Link href="/run/site" className="text-white/50 hover:text-white">
          ← Club site
        </Link>
        {club && (
          <a
            href={`/c/${club.slug}/host`}
            target="_blank"
            rel="noreferrer"
            className="text-white/50 hover:text-white"
          >
            See your hosting page ↗
          </a>
        )}
      </div>
    </div>
  );
}

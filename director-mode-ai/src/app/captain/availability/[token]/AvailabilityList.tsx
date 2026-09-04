'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type AvailMatch = {
  id: string;
  matchAt: string;
  isHome: boolean;
  opponent: string | null;
  location: string | null;
  status: 'yes' | 'no' | 'maybe' | null;
};

const OPTIONS: { value: 'yes' | 'no' | 'maybe'; label: string; bg: string; fg: string }[] = [
  { value: 'yes', label: 'Yes', bg: '#16a34a', fg: '#ffffff' },
  { value: 'no', label: 'No', bg: '#dc2626', fg: '#ffffff' },
  { value: 'maybe', label: 'Maybe', bg: '#475569', fg: '#ffffff' },
];

// Matches are played at the club, so pin every date to club time. A player
// answering from a trip should still see the 9:30am the team actually plays.
const TZ = 'America/Los_Angeles';
const part = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone: TZ }).format(new Date(iso));

export default function AvailabilityList({
  token,
  playerName,
  teamName,
  teamLevel,
  matches,
  preselect,
}: {
  token: string;
  playerName: string;
  teamName: string;
  teamLevel: string | null;
  matches: AvailMatch[];
  preselect: { matchId: string; status: 'yes' | 'no' | 'maybe' } | null;
}) {
  const [state, setState] = useState<Record<string, AvailMatch['status']>>(
    Object.fromEntries(matches.map((m) => [m.id, m.status])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const applied = useRef(false);

  const answered = useMemo(
    () => matches.filter((m) => state[m.id]).length,
    [matches, state],
  );

  async function answer(matchId: string, status: 'yes' | 'no' | 'maybe') {
    setBusy(matchId);
    setError(null);
    const previous = state[matchId];
    setState((s) => ({ ...s, [matchId]: status }));
    try {
      const res = await fetch(`/api/captain/availability/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_id: matchId, status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setState((s) => ({ ...s, [matchId]: previous }));
        setError(j.error || 'Could not save that. Try again.');
      }
    } catch {
      setState((s) => ({ ...s, [matchId]: previous }));
      setError('Network problem — try again.');
    } finally {
      setBusy(null);
    }
  }

  // One-tap from the email: apply the choice carried in the query string.
  useEffect(() => {
    if (applied.current || !preselect) return;
    applied.current = true;
    if (matches.some((m) => m.id === preselect.matchId)) {
      void answer(preselect.matchId, preselect.status);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = matches.length > 0 && answered === matches.length;

  return (
    // The app shell paints a dark navy body; this page is a light, player-facing
    // sheet, so it paints its own surface instead of inheriting one it can't read on.
    <div
      style={{
        colorScheme: 'light',
        background: '#f1f5f9',
        minHeight: '100vh',
        padding: '0 0 56px',
      }}
    >
      <main
        style={{
          fontFamily: "'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          maxWidth: 600,
          margin: '0 auto',
          padding: '20px 16px 0',
          color: '#0f172a',
        }}
      >
        <header
          style={{
            background: 'linear-gradient(135deg,#003049 0%,#001820 100%)',
            borderRadius: 18,
            padding: '22px 22px 20px',
            color: '#fff',
          }}
        >
          <div
            style={{
              fontSize: 12,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: '#D3FB52',
              fontWeight: 700,
            }}
          >
            {teamName}
            {teamLevel ? ` · ${teamLevel}` : ''}
          </div>
          <h1 style={{ fontSize: 27, margin: '8px 0 6px', lineHeight: 1.15 }}>Hi {playerName}</h1>
          <p style={{ margin: 0, fontSize: 15, color: 'rgba(255,255,255,0.78)', lineHeight: 1.45 }}>
            Tap <strong style={{ color: '#fff' }}>Yes</strong>,{' '}
            <strong style={{ color: '#fff' }}>No</strong>, or{' '}
            <strong style={{ color: '#fff' }}>Maybe</strong> for every match below. Change it any
            time — this link stays live all season.
          </p>

          {matches.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div
                style={{
                  height: 8,
                  borderRadius: 99,
                  background: 'rgba(255,255,255,0.14)',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${(answered / matches.length) * 100}%`,
                    height: '100%',
                    background: '#D3FB52',
                    borderRadius: 99,
                    transition: 'width .25s ease',
                  }}
                />
              </div>
              <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: '#D3FB52' }}>
                {done
                  ? `All set — ${matches.length} of ${matches.length} answered 🎾`
                  : `${answered} of ${matches.length} answered · ${matches.length - answered} to go`}
              </div>
            </div>
          )}
        </header>

        {/*
          The whole season, in the parent's phone, from the page they were told
          to bookmark.
          The calendar button shipped after the availability emails had already
          gone out, and a third email in one afternoon to say "here is a button"
          is worse than the missing button. Putting it here means everyone who
          opens their link gets it — which is everyone who still has a date to
          answer — with nothing else sent.
        */}
        {matches.length > 0 && (
          <a
            href={`/api/captain/calendar/${token}`}
            style={{
              display: 'inline-block',
              marginTop: 16,
              padding: '12px 18px',
              borderRadius: 12,
              background: '#e2e8f0',
              color: '#0f172a',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            📅 Add all {matches.length} to my calendar
          </a>
        )}
        {matches.length > 0 && (
          <p style={{ fontSize: 13, color: '#64748b', margin: '8px 0 0' }}>
            Works on iPhone, Google Calendar and Outlook. Every match comes with a reminder the
            night before and an hour ahead.
          </p>
        )}

        {error && (
          <p
            role="alert"
            style={{
              background: '#fee2e2',
              color: '#991b1b',
              padding: '12px 14px',
              borderRadius: 10,
              fontSize: 14,
              fontWeight: 600,
              marginTop: 16,
            }}
          >
            {error}
          </p>
        )}

        {matches.length === 0 && (
          <p
            style={{
              color: '#475569',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 14,
              padding: 20,
              marginTop: 16,
            }}
          >
            No upcoming matches on the schedule yet — check back soon.
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          {matches.map((m) => {
            const picked = state[m.id];
            return (
              <section
                key={m.id}
                style={{
                  background: '#fff',
                  border: picked ? '1px solid #cbd5e1' : '2px solid #0f172a',
                  borderRadius: 16,
                  padding: 16,
                  marginBottom: 14,
                  boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
                  opacity: busy === m.id ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  {/* Calendar chip — the date readable at arm's length. */}
                  <div
                    style={{
                      flex: '0 0 auto',
                      width: 62,
                      borderRadius: 12,
                      overflow: 'hidden',
                      border: '1px solid #e2e8f0',
                      textAlign: 'center',
                    }}
                  >
                    <div
                      style={{
                        background: '#0f172a',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 800,
                        letterSpacing: '.1em',
                        padding: '4px 0',
                      }}
                    >
                      {part(m.matchAt, { month: 'short' }).toUpperCase()}
                    </div>
                    <div
                      style={{
                        fontSize: 26,
                        fontWeight: 800,
                        color: '#0f172a',
                        lineHeight: 1.15,
                        padding: '4px 0 6px',
                      }}
                    >
                      {part(m.matchAt, { day: 'numeric' })}
                    </div>
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 19, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>
                      {part(m.matchAt, { weekday: 'long' })}
                    </div>
                    <div
                      style={{
                        display: 'inline-block',
                        marginTop: 6,
                        background: '#0f172a',
                        color: '#D3FB52',
                        fontSize: 17,
                        fontWeight: 800,
                        padding: '4px 12px',
                        borderRadius: 99,
                        letterSpacing: '.01em',
                      }}
                    >
                      {part(m.matchAt, { hour: 'numeric', minute: '2-digit' })}
                    </div>
                    <div
                      style={{
                        marginTop: 9,
                        fontSize: 15,
                        fontWeight: 600,
                        color: '#1e293b',
                        lineHeight: 1.35,
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: 11,
                          fontWeight: 800,
                          letterSpacing: '.09em',
                          textTransform: 'uppercase',
                          padding: '3px 8px',
                          borderRadius: 6,
                          marginRight: 8,
                          background: m.isHome ? '#dcfce7' : '#e0e7ff',
                          color: m.isHome ? '#166534' : '#3730a3',
                        }}
                      >
                        {m.isHome ? 'Home' : 'Away'}
                      </span>
                      {m.opponent ? `vs ${m.opponent}` : 'Opponent TBD'}
                    </div>
                    {m.location && (
                      <div style={{ marginTop: 5, fontSize: 14, color: '#475569', lineHeight: 1.35 }}>
                        📍 {m.location}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  {OPTIONS.map((o) => {
                    const active = picked === o.value;
                    return (
                      <button
                        key={o.value}
                        onClick={() => answer(m.id, o.value)}
                        disabled={busy === m.id}
                        aria-pressed={active}
                        style={{
                          flex: 1,
                          padding: '13px 8px',
                          borderRadius: 11,
                          border: active ? `2px solid ${o.bg}` : '1.5px solid #cbd5e1',
                          background: active ? o.bg : '#fff',
                          color: active ? o.fg : '#334155',
                          fontWeight: 700,
                          fontSize: 15.5,
                          cursor: busy === m.id ? 'default' : 'pointer',
                          WebkitAppearance: 'none',
                        }}
                      >
                        {active ? `✓ ${o.label}` : o.label}
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        <p
          style={{
            color: '#64748b',
            fontSize: 12.5,
            marginTop: 20,
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          All times are club time (Pacific). Your captain sees these answers.
          <br />
          No account needed — this link is yours. Bookmark it.
        </p>
      </main>
    </div>
  );
}

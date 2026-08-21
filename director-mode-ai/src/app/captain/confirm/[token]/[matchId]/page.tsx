import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { googleCalendarUrl, matchEvent } from '@/lib/captain/calendar';
import { CLUB_TZ } from '@/lib/captain/clubTime';
import type { MatchInfo } from '@/lib/captain/emails';

export const dynamic = 'force-dynamic';

/**
 * Where the lineup email's buttons land.
 *
 * Deliberately has NO client component and no JavaScript of any kind. Players
 * open these links inside whatever webview their mail app embeds, and a button
 * whose onClick only exists after React hydrates is a button that sometimes
 * does nothing at all — which is exactly what a player reported. Plain forms
 * POST, the server writes, the server redirects back here. That works in every
 * client that can render HTML.
 *
 * Normally the player never sees the Yes button: the email's Yes link records
 * the answer on its way through, so they arrive already confirmed.
 */
export default async function ConfirmPage({
  params,
  searchParams,
}: {
  params: { token: string; matchId: string };
  searchParams: { a?: string; e?: string };
}) {
  const admin = getSupabaseAdmin();

  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', params.token)
    .maybeSingle();
  const player = playerRow as { id: string; team_id: string; name: string } | null;

  if (!player) {
    return (
      <Shell>
        <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Link not recognized</h1>
        <p style={{ color: '#475569', margin: 0 }}>Ask your captain to resend the lineup.</p>
      </Shell>
    );
  }

  const [{ data: match }, { data: team }, { data: lineup }] = await Promise.all([
    admin
      .from('captain_matches')
      .select(
        'id, match_at, is_home, opponent, location, arrival_note, opposing_captain_name, opposing_captain_phone',
      )
      .eq('id', params.matchId)
      .eq('team_id', player.team_id)
      .maybeSingle(),
    admin.from('captain_teams').select('name').eq('id', player.team_id).maybeSingle(),
    admin
      .from('captain_lineups')
      .select(
        'court_number, court_type, player1_id, player2_id, player1_confirmed_at, player2_confirmed_at, player1_declined_at, player2_declined_at',
      )
      .eq('match_id', params.matchId)
      .or(`player1_id.eq.${player.id},player2_id.eq.${player.id}`)
      .maybeSingle(),
  ]);

  const m = match as Record<string, unknown> | null;
  const l = lineup as {
    court_number: number;
    court_type: string;
    player1_id: string | null;
    player1_confirmed_at: string | null;
    player2_confirmed_at: string | null;
    player1_declined_at: string | null;
    player2_declined_at: string | null;
  } | null;

  if (!m) {
    return (
      <Shell>
        <h1 style={{ fontSize: 22, margin: '0 0 8px' }}>Match not found</h1>
        <p style={{ color: '#475569', margin: 0 }}>Ask your captain to resend the lineup.</p>
      </Shell>
    );
  }

  // Vercel runs UTC. Without an explicit zone a 9:30am match reads as 4:30 PM.
  const when = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: CLUB_TZ,
  }).format(new Date(m.match_at as string));

  const isSlot1 = l ? l.player1_id === player.id : false;
  const confirmed = l ? !!(isSlot1 ? l.player1_confirmed_at : l.player2_confirmed_at) : false;
  const declined = l ? !!(isSlot1 ? l.player1_declined_at : l.player2_declined_at) : false;
  const court = l ? `${l.court_type === 'singles' ? 'Singles' : 'Doubles'} ${l.court_number}` : null;
  const inLineup = !!l;

  const teamName = (team as { name: string } | null)?.name || 'your team';
  const post = `/api/captain/confirm/${params.token}/${params.matchId}`;

  const info: MatchInfo = {
    id: m.id as string,
    matchAt: m.match_at as string,
    isHome: m.is_home as boolean,
    opponent: (m.opponent as string) || null,
    location: (m.location as string) || null,
    arrivalNote: (m.arrival_note as string) || null,
    opposingCaptainName: (m.opposing_captain_name as string) || null,
    opposingCaptainPhone: (m.opposing_captain_phone as string) || null,
  };
  const gcal = googleCalendarUrl(matchEvent(teamName, info, court));
  const ics = `/api/captain/calendar/${params.token}/${params.matchId}`;

  const detail = [
    m.opponent ? `vs ${m.opponent}` : null,
    m.is_home ? 'Home' : 'Away',
    m.location as string | null,
    m.arrival_note as string | null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Shell>
      <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>{teamName}</p>
      <h1 style={{ fontSize: 24, margin: '4px 0 12px' }}>
        {confirmed
          ? "You're confirmed ✓"
          : declined
            ? "You're out of this lineup"
            : `${player.name}, can you play?`}
      </h1>

      <div style={card}>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{when}</div>
        {detail && <div style={{ color: '#64748b', fontSize: 14, marginTop: 2 }}>{detail}</div>}
        {court && (
          <div style={{ marginTop: 8, fontWeight: 600 }}>
            You&rsquo;re on <span style={{ color: '#0369a1' }}>{court}</span>
          </div>
        )}
      </div>

      {searchParams.e && (
        <p style={{ ...banner, background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }}>
          {searchParams.e}
        </p>
      )}

      {!inLineup && (
        <p style={{ color: '#475569' }}>
          You&rsquo;re not in this lineup right now. If that looks wrong, check with your captain.
        </p>
      )}

      {confirmed && (
        <div style={{ ...banner, background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>
          <strong>Thanks &mdash; your captain knows you&rsquo;re in.</strong>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            Nothing else to do. You&rsquo;ll get a reminder the day before.
          </div>
        </div>
      )}

      {declined && (
        <div style={{ ...banner, background: '#fff1f2', borderColor: '#fecaca', color: '#991b1b' }}>
          <strong>Got it &mdash; your captain has been told.</strong>
          <div style={{ marginTop: 4, fontSize: 14 }}>
            You&rsquo;re marked unavailable for this match. Thanks for the heads-up.
          </div>
          <form method="POST" action={post} style={{ marginTop: 10 }}>
            <input type="hidden" name="action" value="in" />
            <button type="submit" style={linkButton}>
              Actually, I can play &mdash; put me back
            </button>
          </form>
        </div>
      )}

      {/* Yes only shows if something stopped the email link from recording it. */}
      {inLineup && !confirmed && !declined && (
        <form method="POST" action={post}>
          <input type="hidden" name="action" value="in" />
          <button type="submit" style={yesButton}>
            &#10003; Yes &mdash; I&rsquo;ll be there
          </button>
        </form>
      )}

      {inLineup && !declined && (
        <details open={searchParams.a === 'out'} style={{ marginTop: confirmed ? 20 : 10 }}>
          <summary style={summary}>
            {confirmed ? 'Something changed — I can’t play' : '✗ Sorry — I can’t play'}
          </summary>
          <div style={{ ...card, borderColor: '#fecaca', marginTop: 10 }}>
            <strong style={{ fontSize: 16 }}>Pull out of this match?</strong>
            <p style={{ color: '#475569', fontSize: 14, margin: '6px 0 12px' }}>
              Your captain gets an email right away so they can find a sub. Totally fine &mdash;
              just please don&rsquo;t leave it to match morning.
            </p>
            <form method="POST" action={post}>
              <input type="hidden" name="action" value="out" />
              <label htmlFor="note" style={{ display: 'block', fontSize: 13, color: '#475569', marginBottom: 4 }}>
                Anything you want to tell your captain? (optional)
              </label>
              <textarea
                id="note"
                name="note"
                rows={3}
                maxLength={500}
                placeholder="e.g. shoulder is acting up, back for the next one"
                style={textarea}
              />
              <button type="submit" style={outButton}>
                Yes, take me out of this lineup
              </button>
            </form>
          </div>
        </details>
      )}

      {inLineup && !declined && (
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
          <p style={kicker}>Put it on your calendar</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <a href={gcal} target="_blank" rel="noopener noreferrer" style={calButton}>
              &#128197; Google Calendar
            </a>
            <a href={ics} style={calButton}>
              &#128197; Apple / Outlook
            </a>
          </div>
          <p style={{ fontSize: 12, color: '#94a3b8', margin: '10px 0 0' }}>
            Includes your court, the address and the arrival time, with reminders the night before
            and an hour out.
          </p>
        </div>
      )}
    </Shell>
  );
}

/**
 * Paints its own light background: the app shell sets a dark navy body in
 * globals.css, and a player page that leaves it alone renders near-black text
 * on navy on a phone.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ colorScheme: 'light', background: '#f1f5f9', minHeight: '100vh' }}>
      <main
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: 520,
          margin: '0 auto',
          padding: '40px 20px 60px',
          color: '#0f172a',
        }}
      >
        {children}
      </main>
    </div>
  );
}

const card: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  padding: 16,
  marginBottom: 20,
};

const banner: React.CSSProperties = {
  border: '1px solid',
  padding: 16,
  borderRadius: 12,
  margin: '0 0 12px',
};

const yesButton: React.CSSProperties = {
  width: '100%',
  padding: '16px 20px',
  borderRadius: 12,
  border: 'none',
  background: '#D3FB52',
  color: '#0f172a',
  fontWeight: 700,
  fontSize: 17,
  cursor: 'pointer',
};

const outButton: React.CSSProperties = {
  width: '100%',
  marginTop: 12,
  padding: '15px 20px',
  borderRadius: 12,
  border: 'none',
  background: '#dc2626',
  color: '#ffffff',
  fontWeight: 700,
  fontSize: 16,
  cursor: 'pointer',
};

const summary: React.CSSProperties = {
  cursor: 'pointer',
  padding: '13px 16px',
  borderRadius: 12,
  border: '1px solid #fecaca',
  background: '#fff1f2',
  color: '#991b1b',
  fontWeight: 600,
  fontSize: 15,
  textAlign: 'center',
  listStyle: 'none',
};

const linkButton: React.CSSProperties = {
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: '#166534',
  fontSize: 14,
  textDecoration: 'underline',
  cursor: 'pointer',
};

const textarea: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  fontSize: 15,
  fontFamily: 'inherit',
  // The app's Tailwind base turns inputs white-on-white here; set both by hand.
  background: '#ffffff',
  color: '#0f172a',
  boxSizing: 'border-box',
};

const calButton: React.CSSProperties = {
  flex: '1 1 46%',
  textAlign: 'center',
  padding: '13px 16px',
  borderRadius: 10,
  border: '1px solid #cbd5e1',
  background: '#ffffff',
  color: '#0f172a',
  fontWeight: 600,
  fontSize: 15,
  textDecoration: 'none',
};

const kicker: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: '#64748b',
  margin: '0 0 10px',
};

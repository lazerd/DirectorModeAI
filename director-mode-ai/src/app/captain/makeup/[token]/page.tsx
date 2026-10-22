import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CLUB_TZ_EMBED, clubTimeZoneOf } from '@/lib/captain/clubTime';
import MakeupVote from './MakeupVote';

export const dynamic = 'force-dynamic';

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ colorScheme: 'light', background: '#f1f5f9', minHeight: '100vh' }}>
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 540, margin: '0 auto', padding: 40, color: '#0f172a' }}>
        <h1 style={{ fontSize: 22 }}>{title}</h1>
        <p style={{ color: '#475569' }}>{body}</p>
      </main>
    </div>
  );
}

export default async function MakeupPollPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { p?: string; o?: string; a?: string };
}) {
  const admin = getSupabaseAdmin();
  const { data: playerRow } = await admin
    .from('captain_players')
    .select('id, team_id, name')
    .eq('player_token', params.token)
    .maybeSingle();
  if (!playerRow) return <Notice title="Link not recognized" body="Ask your captain to resend the makeup poll." />;
  const player = playerRow as { id: string; team_id: string; name: string };

  const { data: pollRow } = await admin
    .from('captain_makeup_polls')
    .select('id, team_id, match_id, options, note')
    .eq('id', searchParams.p || '')
    .maybeSingle();
  const poll = pollRow as
    | { id: string; team_id: string; match_id: string; options: { at: string }[]; note: string | null }
    | null;
  if (!poll || poll.team_id !== player.team_id) {
    return <Notice title="Poll not found" body="Ask your captain to resend the makeup poll." />;
  }

  const [{ data: team }, { data: match }, { data: votes }] = await Promise.all([
    admin.from('captain_teams').select(`name, ${CLUB_TZ_EMBED}`).eq('id', player.team_id).maybeSingle(),
    admin.from('captain_matches').select('match_at, opponent, location').eq('id', poll.match_id).maybeSingle(),
    admin
      .from('captain_makeup_votes')
      .select('option_index, answer')
      .eq('poll_id', poll.id)
      .eq('player_id', player.id),
  ]);
  const m = match as { match_at: string; opponent: string | null; location: string | null } | null;

  const o = Number(searchParams.o);
  const pre =
    Number.isInteger(o) && o >= 0 && o < poll.options.length && (searchParams.a === 'yes' || searchParams.a === 'no')
      ? { index: o, answer: searchParams.a as 'yes' | 'no' }
      : null;

  return (
    <MakeupVote
      token={params.token}
      pollId={poll.id}
      playerName={player.name}
      teamName={(team as { name: string } | null)?.name || 'Your team'}
      originalAt={m?.match_at || null}
      opponent={m?.opponent || null}
      location={m?.location || null}
      note={poll.note}
      options={poll.options.map((x) => x.at)}
      initial={Object.fromEntries(
        ((votes as { option_index: number; answer: 'yes' | 'no' }[]) || []).map((v) => [v.option_index, v.answer]),
      )}
      preselect={pre}
      timeZone={clubTimeZoneOf(team)}
    />
  );
}

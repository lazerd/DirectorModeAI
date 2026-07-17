import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { eventCanUsePremium } from '@/lib/billing';
import UpgradeButton from '@/components/billing/UpgradeButton';
import DJConsole from '@/components/mixer/event/DJConsole';
import DayPassButton from '@/components/billing/DayPassButton';

export const dynamic = 'force-dynamic';

const TOURNAMENT_FORMATS = new Set([
  'rr-singles',
  'rr-doubles',
  'single-elim-singles',
  'single-elim-doubles',
  'fmlc-singles',
  'fmlc-doubles',
  'ffic-singles',
  'ffic-doubles',
  'compass-singles',
  'compass-doubles',
]);

/** Format a tournament entry as a single "player" name for the announcer. */
function teamName(player_name: string, partner_name: string | null): string {
  return partner_name ? `${player_name} / ${partner_name}` : player_name;
}

/** Convert a tournament_matches.court ("3" or "Center") to a court number. */
function courtToNumber(court: string | null): number {
  if (!court) return 0;
  const n = parseInt(court, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default async function DJConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) redirect(`/login?redirect=/mixer/events/${eventId}/dj`);

  // Use service client for the event read so RLS doesn't reject server-side queries —
  // we enforce ownership in code below. The live tables are events/players/rounds/matches
  // (v1); mixer_events etc. are 0-row v2 tables.
  const supabase = await createServiceClient();
  const { data: event } = await supabase
    .from('events')
    .select('id, name, num_courts, user_id, scoring_format, target_games, round_length_minutes, match_format')
    .eq('id', eventId)
    .single();
  if (!event) notFound();
  if (event.user_id !== user.id) {
    return (
      <div className="px-6 py-12 text-white">
        <p>You don't have access to this event.</p>
      </div>
    );
  }

  const allowed = await eventCanUsePremium(user.id, eventId, 'dj_console');
  if (!allowed) {
    return (
      <div className="px-6 py-12 max-w-2xl mx-auto text-white">
        <Link
          href={`/mixer/events/${eventId}`}
          className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-6"
        >
          <ArrowLeft size={16} /> Back to event
        </Link>
        <div className="rounded-2xl border border-yellow-300/30 bg-yellow-300/5 p-8">
          <div className="flex items-center gap-2 text-yellow-300 text-sm font-medium uppercase tracking-wider mb-2">
            <Sparkles size={14} />
            Premium feature
          </div>
          <h1 className="font-display text-3xl mb-2">DJ Console</h1>
          <p className="text-white/70 mb-6">
            Walk-on songs and a hype announcer voice for every player. Like Ballpark DJ — but for tennis. Free users get one event lifetime; this slot is already used. Upgrade to Pro or unlock just this event with a $9 Day Pass.
          </p>
          <div className="flex flex-col sm:flex-row flex-wrap gap-3">
            <UpgradeButton />
            <DayPassButton eventId={eventId} />
          </div>
          <div className="mt-3">
            <Link href="/pricing" className="text-xs text-white/40 hover:text-white/70">Compare plans</Link>
          </div>
        </div>
      </div>
    );
  }



  const isTournament = TOURNAMENT_FORMATS.has(event.match_format ?? '');

  let players: any[] = [];
  let rounds: any[] = [];
  let matches: any[] = [];

  if (isTournament) {
    // Tournament path — players are tournament_entries (each row = a team
    // for doubles or single player for singles), matches are tournament_matches.
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('id, player_name, partner_name')
      .eq('event_id', eventId)
      .eq('position', 'in_draw');

    // Walkout song fields aren't on tournament_entries (yet). For now the
    // announcer runs without walkouts; the Setlist tab will silently fail
    // on save since save-walkout still writes to the `players` table.
    // TODO: add walkout_* columns to tournament_entries + extend save-walkout.
    players = (entries || [])
      .map((e: any) => ({
        id: e.id,
        name: teamName(e.player_name, e.partner_name),
        walkout_song_url: null,
        walkout_song_title: null,
        walkout_song_artist: null,
        walkout_song_start_seconds: 0,
        walkout_announcer_audio_url: null,
      }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));

    const { data: tournamentMatches } = await supabase
      .from('tournament_matches')
      .select(
        'id, bracket, round, slot, player1_id, player3_id, court, score, winner_side, status'
      )
      .eq('event_id', eventId)
      .order('round')
      .order('slot');

    // Build a synthetic "round" per (bracket, round) pair so the DJ script
    // can group matches by round just like mixer events do.
    const tm = (tournamentMatches || []) as any[];
    const roundKey = (m: any) => `${m.bracket}-r${m.round}`;
    const uniqueRoundKeys = Array.from(new Set(tm.map(roundKey)));
    rounds = uniqueRoundKeys.map((key, idx) => {
      const sample = tm.find((m) => roundKey(m) === key);
      // All matches completed for this round → done. Any in progress → ongoing.
      const inRound = tm.filter((m) => roundKey(m) === key);
      const status = inRound.every((m) => m.status === 'completed')
        ? 'completed'
        : 'pending';
      return {
        id: key,
        round_number: idx + 1,
        status,
        bracket: sample?.bracket ?? 'main',
        round: sample?.round ?? idx + 1,
      };
    });

    matches = tm.map((m: any) => ({
      id: m.id,
      round_id: roundKey(m),
      court_number: courtToNumber(m.court),
      player1_id: m.player1_id,
      player2_id: null,
      player3_id: m.player3_id,
      player4_id: null,
      team1_score: null,
      team2_score: null,
      winner_team:
        m.winner_side === 'a' ? 1 : m.winner_side === 'b' ? 2 : null,
    }));
  } else {
    // Legacy mixer path — players via event_players → players, matches via rounds → matches.
    const { data: eventPlayers } = await supabase
      .from('event_players')
      .select(
        'player:players(id, name, walkout_song_url, walkout_song_title, walkout_song_artist, walkout_song_start_seconds, walkout_announcer_audio_url)'
      )
      .eq('event_id', eventId);

    players = (eventPlayers || [])
      .map((ep: any) => ep.player)
      .filter(Boolean)
      .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

    const { data: mixerRounds } = await supabase
      .from('rounds')
      .select('id, round_number, status')
      .eq('event_id', eventId)
      .order('round_number');
    rounds = mixerRounds || [];

    const roundIds = rounds.map((r: any) => r.id);
    const { data: mixerMatches } = roundIds.length
      ? await supabase
          .from('matches')
          .select(
            'id, round_id, court_number, player1_id, player2_id, player3_id, player4_id, team1_score, team2_score, winner_team'
          )
          .in('round_id', roundIds)
          .order('court_number')
      : { data: [] };
    matches = mixerMatches || [];
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-6xl mx-auto">
      <Link
        href={`/mixer/events/${eventId}`}
        className="inline-flex items-center gap-2 text-white/60 hover:text-white text-sm mb-4"
      >
        <ArrowLeft size={16} /> Back to event
      </Link>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-xl bg-yellow-300/10 flex items-center justify-center">
          <Sparkles size={20} className="text-yellow-300" />
        </div>
        <h1 className="font-display text-3xl text-white">DJ Console</h1>
      </div>
      <p className="text-white/50 text-sm mb-6">
        Pick walkout songs, then run the show. Connect this device to the club PA or a Bluetooth speaker.
      </p>

      <DJConsole
        eventId={eventId}
        eventName={event.name}
        numCourts={event.num_courts || 4}
        players={players.map((p: any) => ({
          id: p.id,
          name: p.name,
          walkoutSongUrl: p.walkout_song_url,
          walkoutSongTitle: p.walkout_song_title,
          walkoutSongArtist: p.walkout_song_artist,
          walkoutSongStartSeconds: p.walkout_song_start_seconds || 0,
          walkoutAnnouncerAudioUrl: p.walkout_announcer_audio_url,
        }))}
        rounds={(rounds || []).map((r) => ({
          id: r.id,
          roundNumber: r.round_number,
          status: r.status,
        }))}
        matches={(matches || []).map((m: any) => ({
          id: m.id,
          roundId: m.round_id,
          courtNumber: m.court_number,
          playerIds: [m.player1_id, m.player2_id, m.player3_id, m.player4_id].filter(Boolean),
          team1Score: m.team1_score,
          team2Score: m.team2_score,
          winnerTeam: m.winner_team,
        }))}
        scoring={{
          scoringFormat: event.scoring_format,
          targetGames: event.target_games,
          roundLengthMinutes: event.round_length_minutes,
          matchFormat: event.match_format,
        }}
      />
    </div>
  );
}


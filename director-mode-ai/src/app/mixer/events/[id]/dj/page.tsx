import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { eventCanUsePremium } from '@/lib/billing';
import DJConsole from '@/components/mixer/event/DJConsole';
import DayPassButton from '@/components/billing/DayPassButton';

export const dynamic = 'force-dynamic';

export default async function DJConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;

  const auth = await createClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) redirect(`/login?redirect=/mixer/events/${eventId}/dj`);

  // Use service client for the event read so RLS doesn't reject server-side queries —
  // we enforce ownership in code below.
  const supabase = await createServiceClient();
  const { data: event } = await supabase
    .from('mixer_events')
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
          <div className="flex flex-wrap gap-3">
            <Link
              href="/pricing"
              className="px-4 py-2.5 rounded-xl bg-yellow-300 text-[#001820] font-medium text-sm flex items-center gap-2 hover:bg-yellow-200"
            >
              See plans
            </Link>
            <DayPassButton eventId={eventId} />
          </div>
        </div>
      </div>
    );
  }



  const { data: players } = await supabase
    .from('mixer_players')
    .select(
      'id, name, walkout_song_url, walkout_song_title, walkout_song_artist, walkout_song_start_seconds, walkout_announcer_audio_url'
    )
    .eq('event_id', eventId)
    .order('name');

  // Fetch all rounds + matches so the script can reference real court assignments
  const { data: rounds } = await supabase
    .from('mixer_rounds')
    .select('id, round_number, status')
    .eq('event_id', eventId)
    .order('round_number');

  const roundIds = (rounds || []).map((r) => r.id);
  const { data: matches } = roundIds.length
    ? await supabase
        .from('mixer_matches')
        .select(
          'id, round_id, court_number, player1_id, player2_id, player3_id, player4_id, team1_score, team2_score, winner_team'
        )
        .in('round_id', roundIds)
        .order('court_number')
    : { data: [] };

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
        players={(players || []).map((p) => ({
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


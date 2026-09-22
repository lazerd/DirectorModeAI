/**
 * POST /api/play/games — post a game that needs players.
 *
 * { club_id, date: 'YYYY-MM-DD', time: 'HH:MM', duration, format, spots,
 *   rating_min?, rating_max?, include_unrated?, court?, note?, my_ntrp? }
 *
 * date + time are wall-clock AT THE CLUB and converted with the club's zone —
 * never `new Date('2026-09-22T09:00')`, which on Vercel means 9am UTC.
 *
 * The membership check, the daily limit and the insert are one Postgres call
 * (pf_post_game). The emails go out after the response, and can take a while at
 * a big club, hence maxDuration.
 */
import { NextResponse } from 'next/server';
import { zonedWallTimeToIso } from '@/lib/captain/clubTime';
import { isCtxError, requireMember } from '@/lib/partnerFinder/actions';
import { inviteMembers } from '@/lib/partnerFinder/notify';
import { loadGame, saveSelfRating } from '@/lib/partnerFinder/server';
import { DAILY_POST_LIMIT, MAX_RECIPIENTS, MAX_SPOTS, isFormat } from '@/lib/partnerFinder/format';
import { isLevelValue, type LevelScale } from '@/lib/levels';
import { background } from '@/lib/partnerFinder/background';
import { isDemoClub } from '@/lib/demo/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** A level off the club's own ladder, null for "any", or NaN for anything else. */
const level = (v: unknown, scale: LevelScale): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isLevelValue(scale, n) ? n : NaN;
};

const ERRORS: Record<string, string> = {
  not_member: 'Only members of this club can post a game.',
  in_past: 'That time has already passed. Pick a time later than now.',
  too_far: 'Games can be posted up to 60 days ahead.',
  rate_limited: `You can post up to ${DAILY_POST_LIMIT} games a day. Try again tomorrow.`,
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ctx = await requireMember(typeof body.club_id === 'string' ? body.club_id : null);
  if (isCtxError(ctx)) return ctx.error;
  const { db, club, user } = ctx;

  const date = String(body.date || '');
  const time = String(body.time || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return NextResponse.json({ error: 'Please pick a day and a time.' }, { status: 400 });
  }
  const startsAt = zonedWallTimeToIso(`${date}T${time}`, club.timezone);
  if (!startsAt) return NextResponse.json({ error: 'Please pick a day and a time.' }, { status: 400 });

  const duration = Number(body.duration);
  if (!Number.isInteger(duration) || duration < 30 || duration > 240) {
    return NextResponse.json({ error: 'Please pick how long you want to play.' }, { status: 400 });
  }
  if (!isFormat(body.format)) {
    return NextResponse.json({ error: 'Please pick singles, doubles, mixed or hitting.' }, { status: 400 });
  }
  const spots = Number(body.spots);
  if (!Number.isInteger(spots) || spots < 1 || spots > MAX_SPOTS) {
    return NextResponse.json({ error: `You can ask for 1 to ${MAX_SPOTS} players.` }, { status: 400 });
  }
  const min = level(body.rating_min, club.levels);
  const max = level(body.rating_max, club.levels);
  if (Number.isNaN(min) || Number.isNaN(max) || (min != null && max != null && min > max)) {
    return NextResponse.json({ error: 'Please check the level range.' }, { status: 400 });
  }
  const court = typeof body.court === 'string' ? body.court.trim().slice(0, 60) : '';
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';

  // A member telling us their level for the first time, on the way past.
  const mine = level(body.my_ntrp, club.levels);
  if (mine != null && !Number.isNaN(mine)) {
    if (ctx.personId) {
      await saveSelfRating(db, { clubId: club.id, personId: ctx.personId, email: user.email, fullName: user.name, ntrp: mine });
    }
  }

  const { data, error } = await db.rpc('pf_post_game', {
    p_club: club.id,
    p_user: user.id,
    p_starts_at: startsAt,
    p_duration: duration,
    p_format: body.format,
    p_spots: spots,
    p_rating_min: min,
    p_rating_max: max,
    p_include_unrated: body.include_unrated !== false,
    p_court: court,
    p_note: note,
    p_daily_limit: DAILY_POST_LIMIT,
  });
  if (error) return NextResponse.json({ error: 'Could not post the game. Please try again.' }, { status: 500 });
  const r = data as { ok: boolean; error?: string; game_id?: string };
  if (!r.ok) {
    return NextResponse.json(
      { error: ERRORS[r.error || ''] || 'Could not post the game.' },
      { status: r.error === 'rate_limited' ? 429 : r.error === 'not_member' ? 403 : 400 },
    );
  }

  /*
   * Answer the poster now; email after. Paced sends to 50 members take ~25s,
   * and a poster staring at "Posting…" that long taps again. The count is who
   * WILL be emailed, read with the same function the send uses.
   */
  const game = await loadGame(db, r.game_id!);
  const { data: recipients } = await db.rpc('pf_game_recipients', { p_game: r.game_id, p_limit: MAX_RECIPIENTS });
  const notifying = ((recipients as unknown[] | null) ?? []).length;
  if (game && notifying > 0) background('invite emails', () => inviteMembers(db, game, club));
  // A demo club's invites are held back by the email guard; say so on screen.
  const demo = await isDemoClub(club.id);
  return NextResponse.json({ ok: true, game_id: r.game_id, notified: notifying, demo });
}

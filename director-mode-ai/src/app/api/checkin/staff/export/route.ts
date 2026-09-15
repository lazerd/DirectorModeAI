/**
 * /api/checkin/staff/export?days=90 — every check-in as CSV, in club time.
 *
 * The raw record behind the findings: guest-fee billing for the pool, and the
 * usage numbers a board takes to its landlord. Staff only; it has emails.
 */

import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { formatInTimeZone } from 'date-fns-tz';
import { normalizeTimeZone } from '@/lib/captain/clubTime';
import { SESSION_COLS, WAIT_COLS, type SessionRow, type WaitRow } from '@/lib/checkin/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote everything that needs it, and defuse spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function GET(req: Request) {
  const ctx = await requireStaffForClub();
  if ('error' in ctx) return ctx.error;
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(730, Math.floor(Number(url.searchParams.get('days')) || 90)));
  const what = url.searchParams.get('type') === 'waits' ? 'waits' : 'sessions';
  const tz = normalizeTimeZone(ctx.club.timezone);
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const local = (iso: string | null, fmt: string) => (iso ? formatInTimeZone(iso, tz, fmt) : '');

  const { data: spaces } = await ctx.db.from('checkin_spaces').select('id, name, kind').eq('club_id', ctx.club.id);
  const spaceOf = new Map(((spaces as { id: string; name: string; kind: string }[] | null) ?? []).map((s) => [s.id, s]));

  let lines: unknown[][];
  if (what === 'sessions') {
    const { data } = await ctx.db
      .from('checkin_sessions')
      .select(SESSION_COLS)
      .eq('club_id', ctx.club.id)
      .gte('started_at', since)
      .order('started_at', { ascending: true })
      .limit(50000);
    lines = [
      ['date', 'start', 'end', 'minutes', 'space', 'kind', 'play_type', 'players', 'player_count', 'members_linked', 'guests', 'guest_names', 'end_reason', 'email'],
      ...((data as SessionRow[] | null) ?? []).map((s) => {
        const end = s.ended_at;
        return [
          local(s.started_at, 'yyyy-MM-dd'),
          local(s.started_at, 'HH:mm'),
          local(end, 'HH:mm'),
          end ? Math.round((Date.parse(end) - Date.parse(s.started_at)) / 60000) : '',
          spaceOf.get(s.space_id)?.name ?? '',
          spaceOf.get(s.space_id)?.kind ?? '',
          s.play_type,
          s.players.map((p) => p.name).join('; '),
          s.player_count,
          s.players.filter((p) => p.user_id).length,
          s.guest_count,
          s.guest_names.join('; '),
          s.status === 'active' ? 'playing' : s.end_reason,
          s.contact_email,
        ];
      }),
    ];
  } else {
    const { data } = await ctx.db
      .from('checkin_waits')
      .select(WAIT_COLS)
      .eq('club_id', ctx.club.id)
      .gte('joined_at', since)
      .order('joined_at', { ascending: true })
      .limit(50000);
    lines = [
      ['date', 'joined', 'offered', 'wait_minutes', 'offered_court', 'play_type', 'players', 'outcome', 'email'],
      ...((data as WaitRow[] | null) ?? []).map((w) => [
        local(w.joined_at, 'yyyy-MM-dd'),
        local(w.joined_at, 'HH:mm'),
        local(w.offered_at, 'HH:mm'),
        w.offered_at ? Math.round((Date.parse(w.offered_at) - Date.parse(w.joined_at)) / 60000) : '',
        w.offered_space_id ? spaceOf.get(w.offered_space_id)?.name ?? '' : '',
        w.play_type,
        w.players.map((p) => p.name).join('; '),
        w.status,
        w.contact_email,
      ]),
    ];
  }

  const csv = lines.map((row) => row.map(cell).join(',')).join('\n');
  const filename = `${ctx.club.slug}-checkin-${what}-${formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Pre-season intake poll.
 *   GET  ?team_id=…              — who has answered and who hasn't
 *   POST { team_id, only_missing? } — email the roster their intake link.
 *                                     only_missing re-asks just the people who
 *                                     never submitted.
 *
 * Mirrors /api/captain/poll, which does the same job for per-match availability.
 */

import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';

// Sends are paced (~2/sec) to stay under Resend's rate limit, so a full roster
// takes ~11s for 20 players — comfortably past the default function timeout.
export const maxDuration = 60;
import { preseasonIntakeEmail, sendAll, type Recipient } from '@/lib/captain/emails';
import { CreditLimitError } from '@/lib/billing';
import { creditLimitResponse } from '@/lib/email';

type Row = {
  id: string;
  name: string;
  email: string | null;
  player_token: string;
  intake_completed_at: string | null;
};

export async function GET(req: Request) {
  const teamId = new URL(req.url).searchParams.get('team_id') || '';
  const ctx = await requireTeam(teamId);
  if (isError(ctx)) return ctx.error;

  const { data } = await ctx.db
    .from('captain_players')
    .select('id, name, email, intake_completed_at')
    .eq('team_id', teamId)
    .eq('active', true)
    .order('name');

  const players = (data as Omit<Row, 'player_token'>[]) || [];
  return NextResponse.json({
    players,
    done: players.filter((p) => p.intake_completed_at).length,
    total: players.length,
    noEmail: players.filter((p) => !p.email).map((p) => p.name),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    only_missing?: boolean;
  };
  if (!body.team_id) {
    return NextResponse.json({ error: 'team_id is required.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, team, teamId, userId } = ctx;

  const { data } = await db
    .from('captain_players')
    .select('id, name, email, player_token, intake_completed_at')
    .eq('team_id', teamId)
    .eq('active', true);

  let rows = (data as Row[]) || [];
  if (body.only_missing) rows = rows.filter((p) => !p.intake_completed_at);

  const recipients: Recipient[] = rows
    .filter((p) => !!p.email)
    .map((p) => ({ playerId: p.id, name: p.name, email: p.email as string, token: p.player_token }));

  if (!recipients.length) {
    return NextResponse.json(
      {
        error: body.only_missing
          ? 'Everyone with an email address has already answered.'
          : 'Nobody on the roster has an email address yet.',
      },
      { status: 400 },
    );
  }

  const payloads = recipients.map((r) =>
    preseasonIntakeEmail(team.name, r, { reminder: body.only_missing === true }),
  );

  try {
    const results = await sendAll(userId, payloads);
    const sent = results.filter((r) => r.sent).length;
    // Name the people who didn't get it. A bare count ("9 failed") tells a captain
    // nothing they can act on — they need to know who to chase or resend to.
    const failedNames = results
      .map((r, i) => (r.sent ? null : { name: recipients[i].name, reason: r.reason }))
      .filter(Boolean) as { name: string; reason: string }[];
    return NextResponse.json({
      sent,
      failed: results.length - sent,
      failedNames: failedNames.map((f) => f.name),
      unsubscribed: failedNames.filter((f) => f.reason === 'unsubscribed').map((f) => f.name),
      skippedNoEmail: rows.length - recipients.length,
    });
  } catch (err) {
    if (err instanceof CreditLimitError) return creditLimitResponse(err);
    throw err;
  }
}

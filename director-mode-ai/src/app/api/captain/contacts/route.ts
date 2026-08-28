/**
 * Fill in missing roster contact details in one pass.
 *   POST { team_id, updates: [{ player_id, phone?, email? }] }
 *
 * Editing 12 players one at a time through the roster's Edit panel is twelve
 * expand-type-collapse cycles, which is why a roster sits at zero mobile
 * numbers and every texting feature built on top of it stays inert. This takes
 * the whole list at once.
 *
 * Numbers are normalised to E.164 on the way in, because a captain types
 * "925-555-0148" and Twilio needs "+19255550148" — and a number that only
 * fails at send time fails silently, hours later, when it matters.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { normalizePhone } from '@/lib/captain/phone';

type Update = { player_id?: string; phone?: string | null; email?: string | null };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    updates?: Update[];
  };

  if (!body.team_id) {
    return NextResponse.json({ error: 'team_id is required.' }, { status: 400 });
  }

  const ctx = await requireTeam(body.team_id);
  if (isError(ctx)) return ctx.error;
  const { db, teamId } = ctx;

  const updates = (body.updates || []).filter((u) => !!u.player_id);
  if (!updates.length) {
    return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 });
  }

  // Every id has to be on THIS team. requireTeam proves the captain owns the
  // team; this proves the rows belong to it.
  const { data: mine } = await db
    .from('captain_players')
    .select('id, name')
    .eq('team_id', teamId);
  const roster = new Map(((mine as { id: string; name: string }[]) || []).map((r) => [r.id, r.name]));
  const stranger = updates.find((u) => !roster.has(u.player_id as string));
  if (stranger) {
    return NextResponse.json({ error: 'That list includes someone from another team.' }, { status: 400 });
  }

  const stamp = new Date().toISOString();
  const saved: string[] = [];
  const rejected: { name: string; value: string }[] = [];
  // Supabase query builders are thenable, not Promises — Promise.all takes
  // either, but the type has to say so.
  const writes: PromiseLike<{ error: { message: string } | null }>[] = [];

  for (const u of updates) {
    const patch: Record<string, unknown> = { updated_at: stamp };
    let touched = false;

    if ('phone' in u) {
      const raw = (u.phone ?? '').toString().trim();
      if (!raw) {
        // Deliberately cleared.
        patch.phone = null;
        touched = true;
      } else {
        const e164 = normalizePhone(raw);
        if (!e164) {
          rejected.push({ name: roster.get(u.player_id as string) || 'that player', value: raw });
          continue;
        }
        patch.phone = e164;
        touched = true;
      }
    }

    if ('email' in u) {
      const raw = (u.email ?? '').toString().trim();
      patch.email = raw || null;
      touched = true;
    }

    if (!touched) continue;

    saved.push(roster.get(u.player_id as string) || '');
    writes.push(
      db.from('captain_players').update(patch).eq('id', u.player_id).eq('team_id', teamId),
    );
  }

  const results = await Promise.all(writes);
  const failed = results.find((r) => r?.error);
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    saved: saved.length,
    // Name what wouldn't parse — a count leaves the captain hunting for it.
    rejected,
  });
}

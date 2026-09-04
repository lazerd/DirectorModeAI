/**
 * POST /api/captain/opponents/import — paste the league's captain contact list.
 *
 * Two calls, the same preview-then-confirm shape as every other paste in
 * CaptainMode:
 *   { team_id, text }                  -> { rows[], warnings[] }   (parse only)
 *   { team_id, commit: true, rows[] }  -> { added, updated }        (write)
 *
 * Nothing is written on the first call. The second re-parses nothing — it takes
 * the rows the captain actually ticked, so unticking a team in the preview is
 * the whole of the decision.
 *
 * Deliberately no LLM. The contact sheet is a grid with a fixed meaning, the
 * parser is tested against the real one, and a model that occasionally moves a
 * phone number one column left would be worse than useless here: nobody
 * proof-reads a contact list until they need it, at which point they are
 * standing on a court on a Sunday.
 */
import { NextResponse } from 'next/server';
import { requireTeam, isError } from '@/lib/captain/server';
import { parseOpponentPaste, type ParsedOpponentRow } from '@/lib/captain/opponentPaste';

export const dynamic = 'force-dynamic';

const MAX_CHARS = 200_000;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    team_id?: string;
    text?: string;
    commit?: boolean;
    rows?: ParsedOpponentRow[];
  };

  const ctx = await requireTeam(body.team_id || '');
  if (isError(ctx)) return ctx.error;

  // ------------------------------------------------------------- preview
  if (!body.commit) {
    const text = (body.text || '').slice(0, MAX_CHARS);
    if (!text.trim()) {
      return NextResponse.json({ error: 'Paste the contact list first.' }, { status: 400 });
    }
    const parsed = parseOpponentPaste(text, {
      division: ctx.team.level,
      ownTeamId: ctx.team.source_team_id,
    });
    return NextResponse.json(parsed);
  }

  // -------------------------------------------------------------- commit
  const rows = (body.rows || []).filter((r) => r && r.teamId && r.teamName);
  if (!rows.length) {
    return NextResponse.json({ error: 'Tick at least one team.' }, { status: 400 });
  }

  let added = 0;
  let updated = 0;

  for (const row of rows) {
    /*
     * Keyed on the opponent NAME, not the league team id, because
     * captain_opponents.opponent has to match captain_matches.opponent
     * verbatim — that string is how a fixture already refers to the other club,
     * and it is the join the match page reads.
     */
    const { data: existing } = await ctx.db
      .from('captain_opponents')
      .select('id')
      .eq('team_id', ctx.teamId)
      .eq('opponent', row.teamName)
      .maybeSingle();

    const fields = {
      team_id: ctx.teamId,
      opponent: row.teamName,
      division: row.division || null,
      source_team_id: row.teamId,
      updated_at: new Date().toISOString(),
    };

    let opponentId = (existing as { id: string } | null)?.id;
    if (opponentId) {
      await ctx.db.from('captain_opponents').update(fields).eq('id', opponentId);
      updated += 1;
    } else {
      const { data: ins, error } = await ctx.db
        .from('captain_opponents')
        .insert(fields)
        .select('id')
        .single();
      if (error) {
        return NextResponse.json(
          { error: `${row.teamName}: ${error.message}`, added, updated },
          { status: 500 },
        );
      }
      opponentId = (ins as { id: string }).id;
      added += 1;
    }

    /*
     * Contacts are replaced wholesale rather than merged. A re-paste of a later
     * version of the sheet is how a captain finds out somebody stepped down,
     * and merging would leave the departed captain on the list forever with no
     * way to tell they had gone.
     */
    await ctx.db.from('captain_opponent_captains').delete().eq('opponent_id', opponentId);

    /*
     * One person, one row — even when the sheet lists them twice.
     *
     * Life Long Tennis has Samuel Kidane in two of the five captain columns on
     * its own row. Sent as-is that is two rows with the same
     * (opponent_id, name), and Postgres rejects the whole statement with
     * "ON CONFLICT DO UPDATE command cannot affect row a second time" — so ONE
     * duplicated name in a 46-team paste failed the entire import, and the
     * captain saw a database error instead of a roster.
     *
     * Deduped on the lowercased name, merging the details rather than keeping
     * only the first: a club often lists someone once with an email and again
     * with a phone, and taking either copy alone would drop the other number.
     */
    const byName = new Map<string, {
      opponent_id: string;
      name: string;
      usta_number: string | null;
      safe_play_expires: string | null;
      email: string | null;
      phone: string | null;
      sort_order: number;
    }>();

    for (const c of row.captains || []) {
      const name = c?.name?.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const seen = byName.get(key);
      if (seen) {
        seen.usta_number ??= c.ustaNumber || null;
        seen.safe_play_expires ??= c.safePlayExpires || null;
        seen.email ??= c.email || null;
        seen.phone ??= c.phone || null;
        continue;
      }
      byName.set(key, {
        opponent_id: opponentId,
        name,
        usta_number: c.ustaNumber || null,
        safe_play_expires: c.safePlayExpires || null,
        email: c.email || null,
        phone: c.phone || null,
        sort_order: byName.size,
      });
    }
    const people = [...byName.values()];

    if (people.length) {
      const { error } = await ctx.db
        .from('captain_opponent_captains')
        .upsert(people, { onConflict: 'opponent_id,name', ignoreDuplicates: false });
      if (error) {
        return NextResponse.json(
          { error: `${row.teamName}: ${error.message}`, added, updated },
          { status: 500 },
        );
      }
    }

    /*
     * Keep the legacy two-contact columns in step. The match page, the host
     * email and the opponent directory all still read them, and leaving them
     * stale would mean a captain seeing one name on screen and a different one
     * on the email that goes out.
     */
    await ctx.db
      .from('captain_opponents')
      .update({
        captain_name: people[0]?.name ?? null,
        captain_email: people[0]?.email ?? null,
        captain_phone: people[0]?.phone ?? null,
        cocaptain_name: people[1]?.name ?? null,
        cocaptain_email: people[1]?.email ?? null,
        cocaptain_phone: people[1]?.phone ?? null,
      })
      .eq('id', opponentId);
  }

  return NextResponse.json({ ok: true, added, updated });
}

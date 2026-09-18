/**
 * Editing the format.
 *
 * Every number in the proposal is provisional until NorCal have argued about
 * it, so all of them are editable here: how many teams, how many divisions,
 * how big a roster, what the rating floor is, whether it's men's or women's or
 * mixed, where it's played, what the prize money is, how long a pick clock
 * runs.
 *
 * One rule shapes the whole file: **the draft is the point of no return.**
 * Before it starts, anything can change. Once picks exist, changing the team
 * count or the draft order would invalidate the snake — pick 14 belongs to a
 * specific slot, and removing a team silently reassigns every pick after it.
 * So team add/remove and slot changes are refused once a draft is live, and
 * say why.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { clampNumber, clampText } from '@/lib/ptl/guard';
import { generateToken } from '@/lib/leagueUtils';

async function gate(seasonId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.', status: 401 as const };

  const db = getSupabaseAdmin();
  const { data: season } = await db
    .from('ptl_seasons')
    .select('id, commissioner_id')
    .eq('id', seasonId)
    .maybeSingle();
  if (!season) return { error: 'Not found.', status: 404 as const };
  if ((season as any).commissioner_id !== user.id && !isPlatformOwnerEmail(user.email)) {
    return { error: 'Not found.', status: 404 as const };
  }
  return { user };
}

/** Has drafting begun? Anything that would renumber the snake is frozen after this. */
async function draftHasStarted(seasonId: string): Promise<boolean> {
  const db = getSupabaseAdmin();
  const { data: draft } = await db
    .from('ptl_drafts')
    .select('id, status')
    .eq('season_id', seasonId)
    .maybeSingle();
  if (!draft) return false;
  if ((draft as any).status === 'pending') return false;
  const { count } = await db
    .from('ptl_draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('draft_id', (draft as any).id);
  return (count ?? 0) > 0 || (draft as any).status !== 'pending';
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const seasonId = clampText(body.seasonId, 64);
    const action = clampText(body.action, 32);
    if (!seasonId || !action) {
      return NextResponse.json({ error: 'Missing season or action.' }, { status: 400 });
    }

    const g = await gate(seasonId);
    if ('error' in g) return NextResponse.json({ error: g.error }, { status: g.status });

    const db = getSupabaseAdmin();

    // ---------------- the season itself ----------------
    if (action === 'season') {
      const patch: Record<string, unknown> = {};
      const name = clampText(body.name, 120);
      if (name) patch.name = name;

      const category = clampText(body.category, 12);
      if (category && ['open', 'mens', 'womens', 'mixed'].includes(category)) {
        patch.category = category;
      }

      const rosterSize = clampNumber(body.rosterSize, 2, 30);
      if (rosterSize != null) patch.roster_size = Math.round(rosterSize);

      const pickSeconds = clampNumber(body.pickSeconds, 15, 3600);
      if (pickSeconds != null) patch.pick_seconds = Math.round(pickSeconds);

      const courts = clampNumber(body.courtsPerDivision, 1, 20);
      if (courts != null) patch.courts_per_division = Math.round(courts);

      const entry = clampNumber(body.entryDollars, 0, 1000);
      if (entry != null) patch.entry_cents = Math.round(entry * 100);

      // Explicit null clears the floor entirely — a valid choice for a pilot
      // that needs to fill the field.
      if ('ratingFloor' in body) {
        const floor = clampNumber(body.ratingFloor, 1, 7);
        patch.rating_floor = body.ratingFloor === null ? null : floor;
      }

      const status = clampText(body.status, 16);
      if (status && ['draft', 'enrolling', 'drafting', 'running', 'complete', 'archived'].includes(status)) {
        patch.status = status;
      }

      const site = clampText(body.defaultSiteName, 160);
      if ('defaultSiteName' in body) patch.default_site_name = site;

      const blurb = clampText(body.blurb, 1200);
      if ('blurb' in body) patch.blurb = blurb;

      if (!Object.keys(patch).length) {
        return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });
      }

      // A pick clock change has to reach the draft row too, or the next
      // deadline is computed from a number nobody can see any more.
      if (patch.pick_seconds) {
        await db.from('ptl_drafts').update({ pick_seconds: patch.pick_seconds }).eq('season_id', seasonId);
      }
      // Same for roster size, which is the draft's rounds.
      if (patch.roster_size) {
        await db.from('ptl_drafts').update({ rounds: patch.roster_size }).eq('season_id', seasonId);
      }

      const { error } = await db.from('ptl_seasons').update(patch).eq('id', seasonId);
      if (error) return NextResponse.json({ error: 'Could not save.' }, { status: 500 });
      return NextResponse.json({ success: true });
    }

    // ---------------- divisions ----------------
    if (action === 'division-save') {
      const id = clampText(body.id, 64);
      const patch: Record<string, unknown> = {
        name: clampText(body.name, 60),
        short_code: clampText(body.shortCode, 12)?.toUpperCase(),
        tier: clampNumber(body.tier, 1, 12),
        nightly_prize_cents: Math.round((clampNumber(body.nightlyDollars, 0, 100000) ?? 0) * 100),
        finals_prize_cents: Math.round((clampNumber(body.finalsDollars, 0, 100000) ?? 0) * 100),
        day_of_week: clampNumber(body.dayOfWeek, 0, 6),
        start_time: clampText(body.startTime, 8),
        end_time: clampText(body.endTime, 8),
        singles_lines: Math.round(clampNumber(body.singlesLines, 0, 6) ?? 1),
        doubles_lines: Math.round(clampNumber(body.doublesLines, 0, 6) ?? 1),
      };
      if (!patch.name || !patch.short_code || patch.tier == null) {
        return NextResponse.json({ error: 'A division needs a name, a code and a tier.' }, { status: 400 });
      }

      const { error } = id
        ? await db.from('ptl_divisions').update(patch).eq('id', id).eq('season_id', seasonId)
        : await db.from('ptl_divisions').insert({ ...patch, season_id: seasonId });

      if (error) {
        return NextResponse.json(
          { error: error.message.includes('duplicate') ? 'That code or tier is already used.' : 'Could not save.' },
          { status: 400 },
        );
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'division-delete') {
      const id = clampText(body.id, 64);
      if (!id) return NextResponse.json({ error: 'Missing division.' }, { status: 400 });
      const { count } = await db
        .from('ptl_nights')
        .select('id', { count: 'exact', head: true })
        .eq('division_id', id);
      if ((count ?? 0) > 0) {
        return NextResponse.json(
          { error: 'That division has nights scheduled. Delete those first.' },
          { status: 409 },
        );
      }
      await db.from('ptl_divisions').delete().eq('id', id).eq('season_id', seasonId);
      return NextResponse.json({ success: true });
    }

    // ---------------- teams ----------------
    if (action === 'team-save') {
      const id = clampText(body.id, 64);
      const started = await draftHasStarted(seasonId);

      const patch: Record<string, unknown> = {
        name: clampText(body.name, 60),
        short_code: clampText(body.shortCode, 8)?.toUpperCase(),
        color: clampText(body.color, 12),
        captain_name: clampText(body.captainName, 80),
        captain_email: clampText(body.captainEmail, 160)?.toLowerCase(),
        captain_is_playing: body.captainIsPlaying !== false,
      };
      if (!patch.name || !patch.short_code) {
        return NextResponse.json({ error: 'A team needs a name and a short code.' }, { status: 400 });
      }

      const slot = clampNumber(body.draftSlot, 1, 64);
      if (slot != null) {
        // Renumbering the snake mid-draft would hand picks to the wrong teams.
        if (started && id) {
          const { data: existing } = await db
            .from('ptl_teams')
            .select('draft_slot')
            .eq('id', id)
            .maybeSingle();
          if ((existing as any)?.draft_slot !== Math.round(slot)) {
            return NextResponse.json(
              { error: 'The draft has started — draft order is locked. Undo the picks first.' },
              { status: 409 },
            );
          }
        }
        patch.draft_slot = Math.round(slot);
      }

      if (!id && started) {
        return NextResponse.json(
          { error: 'The draft has started — adding a team now would renumber every pick.' },
          { status: 409 },
        );
      }

      const { error } = id
        ? await db.from('ptl_teams').update(patch).eq('id', id).eq('season_id', seasonId)
        : await db
            .from('ptl_teams')
            .insert({ ...patch, season_id: seasonId, team_token: generateToken() });

      if (error) {
        return NextResponse.json(
          { error: error.message.includes('duplicate') ? 'That code or draft slot is already used.' : 'Could not save.' },
          { status: 400 },
        );
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'team-delete') {
      const id = clampText(body.id, 64);
      if (!id) return NextResponse.json({ error: 'Missing team.' }, { status: 400 });
      if (await draftHasStarted(seasonId)) {
        return NextResponse.json(
          { error: 'The draft has started — removing a team now would renumber every pick.' },
          { status: 409 },
        );
      }
      await db.from('ptl_teams').delete().eq('id', id).eq('season_id', seasonId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err: any) {
    console.error('[ptl] season settings error', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

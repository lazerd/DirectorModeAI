import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { slugify } from '@/lib/leagueUtils';

/**
 * POST /api/onboarding/first-run
 *
 * Turns a brand-new signup into a club with actual data in it, in one call:
 * a club, its courts, a league, and a few players. A new director currently
 * lands on fifteen tools all reading zero, which looks abandoned rather than
 * new — this is the fix.
 *
 * Deliberately IDEMPOTENT-ish: re-running reuses the club the user already
 * owns and skips names that already exist, so a double-submit or a browser
 * back-button can't produce a second club or duplicate courts.
 *
 * Writes go through getSupabaseAdmin(): createServiceClient() forwards the
 * caller's cookie and is therefore RLS-scoped, which is wrong for setup that
 * has to create the very rows the policies key off.
 */

export const dynamic = 'force-dynamic';

type Body = {
  clubName?: string;
  courtCount?: number;
  leagueName?: string;
  leagueStart?: string;
  players?: string[];
};

/** Short, human-readable, unambiguous (no O/0/I/1) club join code. */
function makeJoinCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

/** Append -2, -3, ... until the slug is free in `table`. */
async function uniqueSlug(table: string, base: string): Promise<string> {
  const admin = getSupabaseAdmin();
  const root = base || 'my-club';
  for (let n = 1; n < 50; n++) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const { data } = await admin.from(table).select('id').eq('slug', candidate).maybeSingle();
    if (!data) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }); }

  const clubName = (body.clubName || '').trim();
  if (!clubName) return NextResponse.json({ error: 'Club name is required' }, { status: 400 });

  // Clamp rather than reject: a typo in the court box shouldn't fail the whole
  // setup and make someone start over.
  const courtCount = Math.max(0, Math.min(30, Math.floor(Number(body.courtCount ?? 0)) || 0));
  const leagueName = (body.leagueName || '').trim();
  const playerNames = (body.players || [])
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .slice(0, 20);

  const admin = getSupabaseAdmin();
  const created = { club: false, courts: 0, league: false, players: 0 };

  try {
    /* ---------------------------------------------------------- club ---- */
    let { data: club } = await admin
      .from('cc_clubs')
      .select('id, name, slug, join_code')
      .eq('owner_id', user.id)
      .limit(1)
      .maybeSingle();

    if (!club) {
      const slug = await uniqueSlug('cc_clubs', slugify(clubName));
      const { data: inserted, error } = await admin
        .from('cc_clubs')
        .insert({
          owner_id: user.id,
          name: clubName,
          slug,
          join_code: makeJoinCode(),
          sports: ['tennis'],
          is_public: true,
          accept_join_requests: true,
        })
        .select('id, name, slug, join_code')
        .single();
      if (error || !inserted) throw new Error(`club: ${error?.message || 'insert failed'}`);
      club = inserted;
      created.club = true;
    } else if (club.name !== clubName) {
      await admin.from('cc_clubs').update({ name: clubName }).eq('id', club.id);
      club.name = clubName;
    }

    // Owner membership — harmless if it already exists.
    await admin
      .from('cc_club_members')
      .upsert(
        { club_id: club.id, user_id: user.id, role: 'owner' },
        { onConflict: 'club_id,user_id', ignoreDuplicates: true },
      );

    /* -------------------------------------------------------- courts ---- */
    if (courtCount > 0) {
      const { data: existing } = await admin
        .from('courts')
        .select('number')
        .eq('club_id', club.id);
      const taken = new Set((existing || []).map((c: { number: number | null }) => c.number));
      const rows = [];
      for (let n = 1; n <= courtCount; n++) {
        if (taken.has(n)) continue;
        rows.push({
          club_id: club.id,
          number: n,
          name: `Court ${n}`,
          sports: ['tennis'],
          status: 'active',
          display_order: n,
        });
      }
      if (rows.length) {
        const { error } = await admin.from('courts').insert(rows);
        if (error) throw new Error(`courts: ${error.message}`);
        created.courts = rows.length;
      }
    }

    /* -------------------------------------------------------- league ---- */
    let leagueId: string | null = null;
    let leagueSlug: string | null = null;
    if (leagueName) {
      const { data: dupe } = await admin
        .from('leagues')
        .select('id, slug')
        .eq('director_id', user.id)
        .eq('name', leagueName)
        .limit(1)
        .maybeSingle();

      if (dupe) {
        leagueId = dupe.id;
        leagueSlug = dupe.slug;
      } else {
        const start = body.leagueStart || new Date().toISOString().slice(0, 10);
        // An 8-week season is the shape almost every club runs; the director can
        // move the end date later. Guessing beats making them pick on day one.
        const end = new Date(`${start}T12:00:00`);
        end.setDate(end.getDate() + 56);

        const slug = await uniqueSlug('leagues', slugify(leagueName));
        const { data: inserted, error } = await admin
          .from('leagues')
          .insert({
            director_id: user.id,
            club_id: club.id,
            name: leagueName,
            slug,
            format: 'individual',
            league_type: 'round_robin',
            start_date: start,
            end_date: end.toISOString().slice(0, 10),
            status: 'open',
          })
          .select('id, slug')
          .single();
        if (error || !inserted) throw new Error(`league: ${error?.message || 'insert failed'}`);
        leagueId = inserted.id;
        leagueSlug = inserted.slug;
        created.league = true;

        // An individual-format league with no category has nowhere to put an
        // entry, so seed the one most clubs start with.
        const { error: catErr } = await admin.from('league_categories').insert({
          league_id: leagueId,
          category_key: 'men_doubles',
          entry_fee_cents: 0,
          is_enabled: true,
        });
        if (catErr) throw new Error(`league category: ${catErr.message}`);
      }
    }

    /* ------------------------------------------------------- players ---- */
    if (playerNames.length) {
      const { data: existing } = await admin
        .from('cc_vault_players')
        .select('full_name')
        .eq('director_id', user.id);
      const have = new Set((existing || []).map((p: { full_name: string }) => p.full_name.toLowerCase()));
      const rows = playerNames
        .filter((n) => !have.has(n.toLowerCase()))
        .map((full_name) => ({
          director_id: user.id,
          full_name,
          primary_sport: 'tennis',
          membership_status: 'active',
          rating_source: 'manual',
        }));
      if (rows.length) {
        const { error } = await admin.from('cc_vault_players').insert(rows);
        if (error) throw new Error(`players: ${error.message}`);
        created.players = rows.length;
      }
    }

    return NextResponse.json({
      ok: true,
      created,
      club: { id: club.id, name: club.name, slug: club.slug, joinCode: club.join_code },
      league: leagueId ? { id: leagueId, slug: leagueSlug } : null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Setup failed';
    // Partial progress is kept on purpose: re-submitting picks up where it
    // stopped rather than making the director redo the steps that worked.
    return NextResponse.json({ error: message, created }, { status: 500 });
  }
}

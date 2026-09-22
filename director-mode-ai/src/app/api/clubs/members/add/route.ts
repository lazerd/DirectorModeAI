/**
 * POST /api/clubs/members/add — put roster people INTO the club, silently.
 *
 *   { ids: [vault player id, ...] } -> { added, already, skipped, results[] }
 *
 * The other door into a club is an invite: we email a join link and wait for
 * the person to accept. That is the right default for strangers, and the wrong
 * one for a director seeding CourtConnect with the members he already coaches
 * every week — nobody wants a "you're invited" email for a club they have
 * belonged to for ten years, and until they click it they are invisible to
 * CourtConnect's matching.
 *
 * So this creates the account for them and seats them as a plain `member`.
 * NOTHING IS SENT by this route. The account has no password; it is confirmed
 * on creation, because we are not asking them to prove an address their club
 * already has on file.
 *
 * They do not need to log in to use what this unlocks: every CourtConnect
 * email carries a per-person token link (/play/i/[token]) and "I'm in" is a
 * button on that page, no session required. If they ever want the board
 * itself, "forgot password" on their own address is the way in.
 *
 * WHAT IT DOES MEAN: from now on they get "a game needs players" email when a
 * game fits their level. Those carry the standard unsubscribe footer and a
 * one-tap stop link, and a member who was seated this way can be removed again
 * from PlayerVault. Do not point this at addresses the club has no
 * relationship with.
 *
 * Owner-only, and never in a demo club.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { blockIfDemo } from '@/lib/demo/server';
import { resolveActiveClub } from '@/lib/clubs/activeClub';

/** One run seats at most this many, so a mis-click cannot seat a whole vault. */
const MAX_PER_CALL = 100;

type Result = {
  id: string;
  name: string;
  email: string | null;
  status: 'added' | 'already' | 'no_email' | 'failed';
  detail?: string;
};

export async function POST(req: Request) {
  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const demo = await blockIfDemo(user.id);
  if (demo) return demo;

  const admin = getSupabaseAdmin();
  /*
   * The club they are RUNNING, not the first one they own. A roster row now
   * names its club, so seating it in a different club of the same director is
   * how Sleepy Hollow's members ended up in Rossmoor.
   */
  const { active } = await resolveActiveClub(user.id, user.email);
  if (!active) return NextResponse.json({ error: 'No club to add anyone to' }, { status: 400 });
  const { data: club } = await admin
    .from('cc_clubs')
    .select('id, name')
    .eq('id', active.id)
    .maybeSingle();
  if (!club) return NextResponse.json({ error: 'No club to add anyone to' }, { status: 400 });

  const { ids } = (await req.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'No players selected' }, { status: 400 });
  }
  if (ids.length > MAX_PER_CALL) {
    return NextResponse.json({ error: `Please add ${MAX_PER_CALL} or fewer at a time.` }, { status: 400 });
  }

  // club_id scopes this to THIS club's roster: an id from another club --
  // including another club the same person runs -- simply isn't found.
  const { data: players } = await admin
    .from('cc_vault_players')
    .select('id, full_name, email')
    .eq('club_id', club.id)
    .in('id', ids as string[]);

  const results: Result[] = [];

  // Sequential: each one is two or three auth/admin round trips, and a burst of
  // parallel createUser calls is how you meet the auth rate limiter.
  for (const p of (players ?? []) as { id: string; full_name: string; email: string | null }[]) {
    const email = (p.email || '').trim().toLowerCase();
    const name = (p.full_name || '').trim();
    if (!email) {
      results.push({ id: p.id, name, email: null, status: 'no_email' });
      continue;
    }

    try {
      const { data: existingId, error: lookupErr } = await admin.rpc('auth_user_id_by_email', { p_email: email });
      if (lookupErr) throw new Error(lookupErr.message);

      let userId = (existingId as string | null) ?? null;
      let fresh = false;

      if (!userId) {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: name ? { full_name: name } : {},
        });
        // A race (or an address auth normalises differently) lands here; look
        // again rather than reporting a failure for someone who now exists.
        if (createErr || !created?.user) {
          const { data: retryId } = await admin.rpc('auth_user_id_by_email', { p_email: email });
          userId = (retryId as string | null) ?? null;
          if (!userId) throw new Error(createErr?.message || 'Could not create that account');
        } else {
          userId = created.user.id;
          fresh = true;
        }
      }

      // The name is what every roster, email and board renders. Fill it when
      // it is missing; never overwrite what an existing account chose itself.
      if (name) {
        const { data: prof } = await admin.from('profiles').select('id, full_name').eq('id', userId).maybeSingle();
        const current = (prof as { full_name: string | null } | null)?.full_name;
        if (!prof) await admin.from('profiles').insert({ id: userId, full_name: name });
        else if (!current || !current.trim()) await admin.from('profiles').update({ full_name: name }).eq('id', userId);
      }

      const { data: seat } = await admin
        .from('cc_club_members')
        .select('role')
        .eq('club_id', club.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (seat) {
        results.push({ id: p.id, name, email, status: 'already' });
        continue;
      }

      const { error: seatErr } = await admin
        .from('cc_club_members')
        .insert({ club_id: club.id, user_id: userId, role: 'member' });
      if (seatErr) throw new Error(seatErr.message);

      /*
       * Nail this vault row to the account the director just seated, so the
       * roster stops re-matching the email and their rating survives an
       * address correction (pf_vault_user_link.sql).
       *
       * Unless that account already belongs to a DIFFERENT roster row. Couples
       * share an inbox: Sleepy Hollow's vault has Ryan Alexander and Vi Le on
       * one address, Steve and Danielle Hawley on another. Seating the second
       * of a pair finds the first one's account by email, and stamping the link
       * would hand one spouse's rating to the other. Leave it unlinked and let
       * a human sort the two people out.
       */
      const { data: taken } = await admin
        .from('cc_vault_players')
        .select('id')
        .eq('club_id', club.id)
        .eq('user_id', userId)
        .neq('id', p.id)
        .limit(1)
        .maybeSingle();
      if (!taken) {
        await admin.from('cc_vault_players').update({ user_id: userId }).eq('id', p.id);
      }

      results.push({ id: p.id, name, email, status: 'added', detail: fresh ? 'new account' : 'existing account' });
    } catch (err) {
      console.error('[members/add]', email, err);
      results.push({ id: p.id, name, email, status: 'failed', detail: err instanceof Error ? err.message : undefined });
    }
  }

  // Ids we were handed that matched no roster row at all (deleted since the
  // page loaded, or a member-only row) are reported as skipped, not silently
  // dropped, so the count on screen adds up to what was selected.
  const seen = new Set(results.map((r) => r.id));
  for (const id of ids as string[]) {
    if (!seen.has(id)) results.push({ id, name: '', email: null, status: 'no_email' });
  }

  return NextResponse.json({
    club: club.name,
    added: results.filter((r) => r.status === 'added').length,
    already: results.filter((r) => r.status === 'already').length,
    skipped: results.filter((r) => r.status === 'no_email').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
  });
}

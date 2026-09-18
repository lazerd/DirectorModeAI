/**
 * Commissioner control of the draft: start, pause, resume, undo, and picking
 * on behalf of a captain who isn't there.
 *
 * Every draft that has ever run needed at least one of these. A captain's
 * phone dies mid-round, someone taps the wrong name, the room needs five
 * minutes. Without an undo the only fix is editing the database by hand while
 * eleven people wait.
 *
 * Gate: the season's commissioner, or the platform owner. Not a club role —
 * PTL is not a club, and its captains and players belong to a dozen different
 * ones.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { clampText, draftError } from '@/lib/ptl/guard';
import { sendCaptainInvite } from '@/lib/ptl/emails';
import { originFrom } from '@/lib/ptl/notify';

type Action = 'start' | 'pause' | 'resume' | 'undo' | 'pick' | 'invite-captains';

async function requireCommissioner(draftId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.', status: 401 as const };

  const db = getSupabaseAdmin();
  const { data: draft } = await db
    .from('ptl_drafts')
    .select('id, season_id')
    .eq('id', draftId)
    .maybeSingle();
  if (!draft) return { error: 'Draft not found.', status: 404 as const };

  const { data: season } = await db
    .from('ptl_seasons')
    .select('id, commissioner_id')
    .eq('id', (draft as any).season_id)
    .maybeSingle();

  const isCommissioner = (season as any)?.commissioner_id === user.id;
  if (!isCommissioner && !isPlatformOwnerEmail(user.email)) {
    // 404 rather than 403: someone who isn't running this league has no need
    // to learn that this control surface exists.
    return { error: 'Not found.', status: 404 as const };
  }
  return { user, seasonId: (draft as any).season_id as string };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const draftId = clampText(body.draftId, 64);
    const action = clampText(body.action, 24) as Action | null;
    if (!draftId || !action) {
      return NextResponse.json({ error: 'Missing draft or action.' }, { status: 400 });
    }

    const gate = await requireCommissioner(draftId);
    if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const db = getSupabaseAdmin();

    /*
     * Mailing every captain their draft link. Not an RPC — it is the one
     * commissioner action that reaches outside the database, and it is sent
     * sequentially with a pause between rather than in parallel, because Resend
     * rate-limits and a captain silently missing their link is the failure that
     * ruins draft night.
     */
    if (action === 'invite-captains') {
      const { data: season } = await db
        .from('ptl_seasons')
        .select('id, name, roster_size, is_demo')
        .eq('id', gate.seasonId)
        .maybeSingle();
      if (!season) return NextResponse.json({ error: 'Season not found.' }, { status: 404 });

      if ((season as any).is_demo) {
        return NextResponse.json({
          success: true,
          sent: 0,
          skipped: 0,
          notice: 'This is a demo season — no email was sent.',
        });
      }

      const { data: teams } = await db
        .from('ptl_teams')
        .select('name, captain_name, captain_email, team_token')
        .eq('season_id', gate.seasonId)
        .order('draft_slot', { ascending: true });

      const origin = originFrom(request);
      let sent = 0;
      let skipped = 0;
      for (const t of ((teams as any[]) || [])) {
        if (!t.captain_email) {
          skipped++;
          continue;
        }
        const ok = await sendCaptainInvite(
          { to: t.captain_email, seasonIsDemo: false, origin },
          {
            captainName: t.captain_name,
            teamName: t.name,
            seasonName: (season as any).name,
            token: t.team_token,
            rosterSize: (season as any).roster_size,
          },
        );
        if (ok) sent++;
        else skipped++;
        await new Promise((r) => setTimeout(r, 600));
      }

      return NextResponse.json({ success: true, sent, skipped });
    }

    let rpc: { data: unknown; error: unknown };

    switch (action) {
      case 'start':
      case 'resume':
        // Same call: ptl_start_draft resumes from the pick it was on if there
        // is one, and finds the first open pick if there isn't.
        rpc = await db.rpc('ptl_start_draft', { p_draft: draftId });
        break;

      case 'pause':
        rpc = await db.rpc('ptl_pause_draft', { p_draft: draftId });
        break;

      case 'undo':
        rpc = await db.rpc('ptl_undo_last_pick', { p_draft: draftId });
        break;

      case 'pick': {
        // Picking for an absent captain. Goes through exactly the same
        // ptl_make_pick as a captain's own pick — including the turn check, so
        // the commissioner cannot accidentally pick out of order either.
        const teamId = clampText(body.teamId, 64);
        const entryId = clampText(body.entryId, 64);
        if (!teamId || !entryId) {
          return NextResponse.json({ error: 'Missing team or player.' }, { status: 400 });
        }
        rpc = await db.rpc('ptl_make_pick', {
          p_draft: draftId,
          p_team: teamId,
          p_entry: entryId,
          p_auto: false,
          p_actor: 'commissioner',
        });
        break;
      }

      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
    }

    if (rpc.error) {
      const mapped = draftError(rpc.error);
      return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
    }

    return NextResponse.json({ success: true, state: rpc.data });
  } catch (err: any) {
    const mapped = draftError(err);
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status });
  }
}

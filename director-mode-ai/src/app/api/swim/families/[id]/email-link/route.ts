/**
 * POST /api/swim/families/[id]/email-link
 *
 * Director-only. Sends the family their magic signup link
 * (`${origin}/swim-family/${family_token}`) via email.
 *
 * Returns: { sent: boolean, error?: string, reason?: string }
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendSwimFamilyLinkEmail } from '@/lib/swimEmails';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const familyId = params.id;
  if (!familyId) {
    return NextResponse.json({ error: 'family id required' }, { status: 400 });
  }

  const userClient = await createClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = getSupabaseAdmin();

  const { data: family } = await admin
    .from('swim_families')
    .select('*')
    .eq('id', familyId)
    .maybeSingle();
  if (!family) {
    return NextResponse.json({ error: 'Family not found' }, { status: 404 });
  }

  // Verify the caller owns the season this family belongs to.
  const { data: season } = await admin
    .from('swim_seasons')
    .select('id, name, default_points_required, director_id')
    .eq('id', (family as any).season_id)
    .maybeSingle();
  if (!season) {
    return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  }
  if ((season as any).director_id !== user.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  const recipient = (family as any).primary_email;
  if (!recipient) {
    return NextResponse.json(
      { sent: false, error: 'This family has no email on file. Add one in the Families form.' },
      { status: 400 }
    );
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const signupUrl = `${origin}/swim-family/${(family as any).family_token}`;
  const target =
    (family as any).points_required ?? (season as any).default_points_required;

  const result = await sendSwimFamilyLinkEmail({
    to: recipient,
    familyName: (family as any).family_name,
    seasonName: (season as any).name,
    signupUrl,
    pointsTarget: target,
  });

  if (!result.sent) {
    return NextResponse.json(
      {
        sent: false,
        error:
          result.reason === 'unsubscribed'
            ? 'This recipient has unsubscribed from CoachMode emails.'
            : 'Email failed to send.',
        reason: result.reason,
      },
      { status: result.reason === 'unsubscribed' ? 409 : 500 }
    );
  }

  return NextResponse.json({ sent: true, to: recipient });
}

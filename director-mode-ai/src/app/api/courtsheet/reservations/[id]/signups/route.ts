import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';
import { CourtSheetEngine } from '@/lib/courtsheet/engine';

export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/courtsheet/reservations/[id]/signups
 *   body: { identity: { user_id?, vault_player_id?, guest_name?, guest_email? },
 *           note?: string }
 *
 * Sign up for a reservation. Auth flow:
 *   - If signed in: identity defaults to {user_id: <auth user>}
 *   - If guest: identity must contain guest_name + guest_email
 *   - If staff is registering a player on someone's behalf: identity may
 *     contain vault_player_id (PlayerVault row).
 */
export async function POST(req: Request, { params }: RouteParams) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const note = (body?.note as string | null) ?? null;
  let identity = (body?.identity as Record<string, unknown> | undefined) ?? {};

  // Look up the reservation to find its club (anyone with the link can try).
  const adminDb = getSupabaseAdmin();
  const { data: reservation } = await adminDb
    .from('reservations')
    .select('id, club_id, signups_open, status')
    .eq('id', id)
    .maybeSingle();
  if (!reservation) {
    return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
  }
  if (reservation.status !== 'confirmed' || !reservation.signups_open) {
    return NextResponse.json({ error: 'Signups closed' }, { status: 400 });
  }

  // If the caller is signed in and didn't specify another identity, use them.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let actorUserId: string | null = null;
  if (user) {
    actorUserId = user.id;
    if (
      !identity.user_id &&
      !identity.vault_player_id &&
      !(identity.guest_name && identity.guest_email)
    ) {
      identity = { user_id: user.id };
    }
  }

  if (
    !identity.user_id &&
    !identity.vault_player_id &&
    !(identity.guest_name && identity.guest_email)
  ) {
    return NextResponse.json(
      { error: 'Provide user_id, vault_player_id, or guest_name + guest_email' },
      { status: 400 }
    );
  }

  const engine = await CourtSheetEngine.load({ db: adminDb, club_id: reservation.club_id });
  try {
    const result = await engine.signup(
      id,
      identity as Parameters<typeof engine.signup>[1],
      note,
      actorUserId
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to sign up', detail: (err as Error).message },
      { status: 400 }
    );
  }
}

/**
 * DELETE /api/courtsheet/reservations/[id]/signups?signup_id=...
 * Cancel a signup. Staff or the signed-in user themselves.
 */
export async function DELETE(req: Request, { params }: RouteParams) {
  const { id } = await params;
  const url = new URL(req.url);
  const signup_id = url.searchParams.get('signup_id');
  if (!signup_id) {
    return NextResponse.json({ error: 'Missing signup_id' }, { status: 400 });
  }

  const adminDb = getSupabaseAdmin();
  const { data: row } = await adminDb
    .from('reservation_signups')
    .select('id, reservation_id, user_id')
    .eq('id', signup_id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (row.reservation_id !== id) {
    return NextResponse.json({ error: 'Mismatched reservation' }, { status: 400 });
  }

  // Auth: either the user themselves, or a staff member of the club.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const isSelf = row.user_id === user.id;
  let isStaff = false;
  if (!isSelf) {
    const ctx = await requireStaffForClub({ requireWrite: true });
    if ('error' in ctx) return ctx.error;
    isStaff = true;
  }
  if (!isSelf && !isStaff) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Resolve the reservation's club for engine init.
  const { data: r2 } = await adminDb
    .from('reservations')
    .select('club_id')
    .eq('id', id)
    .single();
  const engine = await CourtSheetEngine.load({ db: adminDb, club_id: r2!.club_id });
  const result = await engine.cancelSignup(signup_id, user.id);
  return NextResponse.json(result);
}

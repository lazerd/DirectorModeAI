/**
 * The blast-booking path, moved off the browser and behind the service role.
 *   GET  ?slot_id=…            — the slot, for the booking page
 *   POST { slot_id }           — claim it as the signed-in client
 *
 * WHY THIS EXISTS: lesson_slots used to carry two permissive policies —
 * `SELECT USING (true)` and an UPDATE any authenticated user could run against
 * any open slot at any club. That was survivable when a slot held nothing but a
 * time; it stopped being survivable when open-lesson bookings started storing
 * the client's name, email, phone and notes on the same row. Locking the table
 * down means this page can no longer read or write it directly, so the reads
 * and the claim happen here, scoped to the caller.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

/** What the booking page may see about a slot before anyone books it. */
const PUBLIC_COLUMNS = 'id, coach_id, start_time, end_time, location, status';

export async function GET(req: Request) {
  const slotId = new URL(req.url).searchParams.get('slot_id') || '';
  if (!slotId) return NextResponse.json({ error: 'Missing slot.' }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data: slot } = await db
    .from('lesson_slots')
    .select(PUBLIC_COLUMNS)
    .eq('id', slotId)
    .maybeSingle();
  if (!slot) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const { data: coach } = await db
    .from('lesson_coaches')
    .select('display_name')
    .eq('id', slot.coach_id as string)
    .maybeSingle();

  // Deliberately never returns guest_name / guest_email / guest_phone: whoever
  // booked a slot is nobody else's business.
  return NextResponse.json({
    slot: { ...slot, coach: { display_name: (coach?.display_name as string) || null } },
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { slot_id?: string };
  if (!body.slot_id) return NextResponse.json({ error: 'Missing slot.' }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

  const db = getSupabaseAdmin();

  const { data: client } = await db
    .from('lesson_clients')
    .select('id')
    .eq('profile_id', user.id)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: 'No client profile for this account.' }, { status: 403 });
  }

  const { data: slot } = await db
    .from('lesson_slots')
    .select('id, coach_id, status')
    .eq('id', body.slot_id)
    .maybeSingle();
  if (!slot) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  /**
   * The coach's approval is the point of this path — a blast goes to invited
   * clients, not to anyone holding a link. Checked here rather than in the
   * browser, where it was only ever a UI state.
   */
  const { data: relationship } = await db
    .from('lesson_client_coaches')
    .select('status')
    .eq('client_id', client.id)
    .eq('coach_id', slot.coach_id as string)
    .maybeSingle();
  if (relationship?.status !== 'approved') {
    return NextResponse.json(
      { error: 'Your coach has not approved you for booking yet.' },
      { status: 403 },
    );
  }

  // Conditional update: two people tapping the same slot, one winner.
  const { data: claimed } = await db
    .from('lesson_slots')
    .update({
      status: 'booked',
      booked_by_client_id: client.id,
      booked_at: new Date().toISOString(),
    })
    .eq('id', body.slot_id)
    .in('status', ['open', 'available'])
    .select('id')
    .maybeSingle();

  if (!claimed) {
    return NextResponse.json(
      { error: 'Sorry, that slot was just booked by someone else.', code: 'taken' },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true });
}

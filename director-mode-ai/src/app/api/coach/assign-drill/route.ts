/**
 * Coach Mode — assign a drill to a player.
 *  GET  -> { isCoach, clients: [{id, name}] }  (the coach's clients, for the picker)
 *  POST { clientId, drillId, note } -> assigns the drill to that client.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

async function coachFor(userId: string) {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from('lesson_coaches').select('id, club_id').eq('profile_id', userId).maybeSingle();
  return data as { id: string; club_id: string | null } | null;
}

export async function GET() {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ isCoach: false, clients: [] });
  const coach = await coachFor(user.id);
  if (!coach) return NextResponse.json({ isCoach: false, clients: [] });
  const admin = getSupabaseAdmin();
  const { data: links } = await admin
    .from('lesson_client_coaches')
    .select('lesson_clients(id, name)')
    .eq('coach_id', coach.id);
  const clients = (links || []).map((l: any) => l.lesson_clients).filter(Boolean);
  return NextResponse.json({ isCoach: true, clients });
}

export async function POST(req: Request) {
  const userClient = await createClient();
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const coach = await coachFor(user.id);
  if (!coach) return NextResponse.json({ error: 'Set up your coach profile first (Lessons → Settings).' }, { status: 400 });

  const { clientId, drillId, note } = await req.json().catch(() => ({}));
  if (!clientId || !drillId) return NextResponse.json({ error: 'Missing player or drill' }, { status: 400 });

  const admin = getSupabaseAdmin();
  // Confirm the client is linked to this coach.
  const { data: link } = await admin
    .from('lesson_client_coaches')
    .select('id')
    .eq('coach_id', coach.id)
    .eq('client_id', clientId)
    .maybeSingle();
  if (!link) return NextResponse.json({ error: 'That player is not one of your clients.' }, { status: 403 });

  const { error } = await admin.from('client_drills').insert({
    client_id: clientId,
    coach_id: coach.id,
    drill_id: drillId,
    club_id: coach.club_id ?? null,
    note: note || null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

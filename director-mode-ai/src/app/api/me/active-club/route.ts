/**
 * Which club am I running, and switch it.
 *
 *   GET  — the clubs I can reach, and which one is active
 *   POST { club_id } — switch to it
 *
 * The switch is validated against what the user may actually reach, so this is
 * not a way to reach a club you have no claim on: an id you cannot reach is
 * refused, not stored.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveClub, setActiveClub } from '@/lib/clubs/activeClub';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ clubs: [], active: null });

  const { active, clubs } = await resolveActiveClub(user.id, user.email);
  return NextResponse.json({
    active,
    clubs,
    // The switcher is pointless with one club, so the UI hides itself.
    canSwitch: clubs.length > 1,
  });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { club_id?: string };
  const wanted = (body.club_id || '').trim();
  if (!wanted) return NextResponse.json({ error: 'Which club?' }, { status: 400 });

  const { clubs } = await resolveActiveClub(user.id, user.email);
  const match = clubs.find((c) => c.id === wanted);
  if (!match) {
    return NextResponse.json({ error: 'You cannot reach that club.' }, { status: 403 });
  }

  await setActiveClub(match.id);
  return NextResponse.json({ ok: true, active: match });
}

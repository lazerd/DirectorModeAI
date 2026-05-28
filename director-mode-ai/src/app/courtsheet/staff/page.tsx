import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import StaffSheetClient from './StaffSheetClient';

export const dynamic = 'force-dynamic';

export default async function CourtSheetStaffPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/courtsheet/staff');

  const db = getSupabaseAdmin();

  // Resolve / bootstrap the user's club inline so the page renders without
  // a separate round-trip.
  let { data: club } = await db
    .from('cc_clubs')
    .select('id, slug, name, timezone, operating_hours, is_public, owner_id')
    .eq('owner_id', user.id)
    .order('name', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!club) {
    // Mirrors requireStaffForClub() — same flow.
    const baseSlug = (user.email ?? 'club').split('@')[0].toLowerCase().replace(/[^a-z0-9-]/g, '-');
    let slug = baseSlug || 'club';
    let n = 1;
    while (true) {
      const { data: existing } = await db.from('cc_clubs').select('id').eq('slug', slug).maybeSingle();
      if (!existing) break;
      n += 1;
      slug = `${baseSlug}-${n}`;
      if (n > 50) {
        slug = `${baseSlug}-${Date.now()}`;
        break;
      }
    }
    const { data: created } = await db
      .from('cc_clubs')
      .insert({
        owner_id: user.id,
        name: `${(user.email ?? 'My').split('@')[0]}'s Club`,
        slug,
        sports: ['tennis'],
        is_public: false,
        timezone: 'America/Los_Angeles',
      })
      .select('id, slug, name, timezone, operating_hours, is_public, owner_id')
      .single();
    club = created;
    if (club) {
      await db
        .from('cc_club_members')
        .insert({ club_id: club.id, user_id: user.id, role: 'owner' });
    }
  }

  if (!club) {
    return (
      <div className="min-h-screen bg-[#001820] text-white p-8">
        Could not initialize club.
      </div>
    );
  }

  const { data: courts } = await db
    .from('courts')
    .select('*')
    .eq('club_id', club.id)
    .neq('status', 'hidden')
    .order('display_order', { ascending: true });

  return (
    <StaffSheetClient
      club={club as any}
      initialCourts={(courts ?? []) as any}
      ownerEmail={user.email ?? ''}
    />
  );
}

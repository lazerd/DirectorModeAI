import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import StaffSheetClient from './StaffSheetClient';
import { requireStaffForClub } from '@/lib/courtsheet/routeAuth';

export const dynamic = 'force-dynamic';

export default async function CourtSheetStaffPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/courtsheet/staff');

  // Same resolution as every CourtSheet API route: a club they own, else the
  // club they're staff at (an invited director / coach / front desk), and only
  // a brand-new user with no club at all gets one bootstrapped. This page used
  // to look for an OWNED club only, so invited staff got a stray
  // "<email>'s Club" instead of their real one.
  const ctx = await requireStaffForClub();
  if ('error' in ctx) {
    // A plain member has no business on the staff sheet — send them home.
    if (ctx.error.status === 403) redirect('/client/dashboard');
    if (ctx.error.status === 401) redirect('/login?redirect=/courtsheet/staff');
    return (
      <div className="min-h-screen bg-[#001820] text-white p-8">
        Could not initialize club.
      </div>
    );
  }
  const { club, db } = ctx;

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

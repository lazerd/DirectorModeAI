/**
 * The list of accounts the platform owner can step into.
 *
 * Deliberately a plain, searchable list of real accounts rather than a
 * directory of everyone in the club: "view as" needs a login to borrow, and a
 * roster player with no account has nothing to borrow. Anyone missing here has
 * never signed in, which is usually the actual answer to "why can't they see
 * it" and worth knowing on its own.
 */

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { readViewAs } from '@/lib/impersonation';
import ViewAsList, { type ViewAsPerson } from '@/components/admin/ViewAsList';

export const dynamic = 'force-dynamic';

export default async function ViewAsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/view-as');

  // Mid-session this page is reached as the TARGET, whose email is not an
  // owner's — so say that plainly instead of showing a bare Not found.
  const borrowed = await readViewAs();
  if (borrowed) {
    return (
      <div className="min-h-screen bg-[#001820] p-6 md:p-10">
        <div className="max-w-2xl">
          <h1 className="text-3xl font-display text-white">View as</h1>
          <p className="mt-3 text-white/60">
            You are currently viewing as {borrowed.targetLabel}. Use the bar at the bottom of the
            screen to come back to your own account, then pick someone else.
          </p>
        </div>
      </div>
    );
  }

  if (!isPlatformOwnerEmail(user.email)) redirect('/');

  const admin = getSupabaseAdmin();

  /*
   * auth.users is the source of truth for who can be borrowed, but it carries
   * no names — so the list is auth emails joined to profiles for a full name,
   * and to cc_club_members for the role that makes a row recognisable ("Megan
   * Sullivan · captain at Sleepy Hollow" rather than a bare address).
   */
  const { data: authList } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const users = (authList?.users ?? []).filter(
    (u) => u.email && !isPlatformOwnerEmail(u.email) && u.id !== user.id,
  );

  const ids = users.map((u) => u.id);
  const [{ data: profiles }, { data: memberships }, { data: captainTeams }] = await Promise.all([
    admin.from('profiles').select('id, full_name').in('id', ids),
    admin.from('cc_club_members').select('user_id, role, club_id').in('user_id', ids),
    admin.from('captain_teams').select('captain_user_id, name').in('captain_user_id', ids),
  ]);

  const clubIds = Array.from(
    new Set(
      ((memberships as { club_id: string }[] | null) ?? []).map((m) => m.club_id).filter(Boolean),
    ),
  );
  const { data: clubs } = clubIds.length
    ? await admin.from('cc_clubs').select('id, name').in('id', clubIds)
    : { data: [] };
  const clubName = new Map(
    ((clubs as { id: string; name: string }[] | null) ?? []).map((c) => [c.id, c.name]),
  );

  const nameById = new Map(
    ((profiles as { id: string; full_name: string | null }[] | null) ?? []).map((p) => [
      p.id,
      p.full_name,
    ]),
  );

  const rolesById = new Map<string, string[]>();
  for (const m of ((memberships as { user_id: string; role: string; club_id: string }[] | null) ??
    [])) {
    const at = clubName.get(m.club_id);
    const label = at ? `${m.role} at ${at}` : m.role;
    rolesById.set(m.user_id, [...(rolesById.get(m.user_id) ?? []), label]);
  }
  for (const t of ((captainTeams as { captain_user_id: string; name: string }[] | null) ?? [])) {
    rolesById.set(t.captain_user_id, [
      ...(rolesById.get(t.captain_user_id) ?? []),
      `captain of ${t.name}`,
    ]);
  }

  const people: ViewAsPerson[] = users
    .map((u) => ({
      id: u.id,
      email: u.email as string,
      name: nameById.get(u.id) || null,
      roles: rolesById.get(u.id) ?? [],
      lastSignInAt: u.last_sign_in_at ?? null,
    }))
    // Someone who has never signed in has no session to borrow — they sort
    // last, and the list says so rather than failing on the click.
    .sort((a, b) => {
      if (!!a.lastSignInAt !== !!b.lastSignInAt) return a.lastSignInAt ? -1 : 1;
      return (a.name || a.email).localeCompare(b.name || b.email);
    });

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-display text-white">View as</h1>
        <p className="mt-2 text-white/50">
          Open the app on someone else&apos;s screen — their teams, their menus, their permissions —
          and fix things there with them. Every switch is logged, and everything you change is saved
          as them.
        </p>
        <ViewAsList people={people} />
      </div>
    </div>
  );
}

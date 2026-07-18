import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import DeskHub from '@/components/tournament/DeskHub';

export const dynamic = 'force-dynamic';

// The unified Tournament Desk Hub — one shared court board across all of a
// director's running tournament events (e.g. Gold + Silver + 12U + 13U). Pass
// ?events=id,id to pin a specific set; otherwise it loads every running
// tournament event the director owns.
export default async function TournamentDeskPage({
  searchParams,
}: {
  searchParams: Promise<{ events?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/mixer/tournaments/desk');

  const sp = await searchParams;
  const initialEvents = (sp.events ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  return <DeskHub initialEvents={initialEvents} />;
}

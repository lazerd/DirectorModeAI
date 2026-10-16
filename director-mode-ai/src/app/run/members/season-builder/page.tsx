import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SeasonBuilder from './SeasonBuilder';

/**
 * Season Builder — one pre-season email to every adult member: who wants to
 * play which USTA league, at what level, day or nights/weekends, and who will
 * captain. Answers roll up into a live head count that turns into teams.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Season Builder — ClubMode AI' };

export default async function SeasonBuilderPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/members/season-builder');
  return <SeasonBuilder />;
}

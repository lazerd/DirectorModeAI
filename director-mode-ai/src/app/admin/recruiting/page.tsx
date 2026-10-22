/**
 * Recruiting flywheel console (platform owner only): sourced jobs and their funnel
 * (ranked → contacted → confirmed interested → club pitched → claimed), the outreach
 * approval queue, the sent log, and buttons to run the scout / recruiter now.
 */
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import RecruitingDashboard from './RecruitingDashboard';

export const dynamic = 'force-dynamic';

export default async function RecruitingAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/recruiting');
  if (!isPlatformOwnerEmail(user.email)) notFound();
  return <RecruitingDashboard />;
}

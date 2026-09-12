import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import HostingManager from './HostingManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Hosting — ClubMode',
  description: 'Season packages for visiting teams, and who is asking to host.',
};

export default async function HostingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/site/hosting');

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-4xl">
        <h1 className="font-display text-3xl text-white">Hosting visiting teams</h1>
        <p className="mt-1 text-white/50">
          Sell a whole league season to a team with no home courts.
        </p>
        <div className="mt-8">
          <HostingManager />
        </div>
      </div>
    </div>
  );
}

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SiteEditor from './SiteEditor';

/**
 * Club site — the annual half of the editor.
 *
 * Behind /run, which middleware already gates, so no new protected path.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Club site — ClubMode',
  description: "Your club's own public website.",
};

export default async function ClubSitePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/site');

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl text-white">Your club website</h1>
        <p className="mt-1 text-white/50">
          Everything on your public page, editable here. It saves as you type.
        </p>
        <div className="mt-8">
          <SiteEditor />
        </div>
      </div>
    </div>
  );
}

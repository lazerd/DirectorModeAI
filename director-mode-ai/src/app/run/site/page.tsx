import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveActiveClub } from '@/lib/clubs/activeClub';
import SetupChecklist from '@/components/clubSite/SetupChecklist';
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

  const { active } = await resolveActiveClub(user.id, user.email);

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl text-white">Your club website</h1>
        <p className="mt-1 text-white/50">
          Everything on your public page, editable here. It saves as you type.
        </p>

        {/*
          What is still unfinished, BEFORE the editor.
          
          A club owner who lands on a long editor with no idea what is
          incomplete scrolls, gives up, and messages whoever set the site up —
          at which point we have become the developer they were paying to
          escape. Naming the work, counting it, and linking straight to the
          screen is what makes it their job. It renders nothing once done.
        */}
        {active && (
          <div className="mt-8">
            <SetupChecklist clubId={active.id} />
          </div>
        )}

        <div className="mt-8">
          <SiteEditor />
        </div>
      </div>
    </div>
  );
}

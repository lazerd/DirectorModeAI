import { redirect } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import EmbedSettings from './EmbedSettings';

/**
 * "Add ClubMode to your existing website."
 *
 * For the club that keeps its own site — Wild Apricot for dues, a volunteer's
 * WordPress — and wants its classes and calendar ON it rather than behind a
 * link to ours. Behind /run, which middleware already gates.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Add to your website — ClubMode',
  description: 'Put your classes, calendar and court booking on the website you already have.',
};

export default async function EmbedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/site/embed');

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-4xl">
        <Link href="/run/site" className="text-sm text-white/50 hover:text-white">
          ← Your club website
        </Link>
        <h1 className="mt-3 font-display text-3xl text-white">Add to your existing website</h1>
        <p className="mt-1 max-w-2xl text-white/50">
          Already have a website you like? Keep it. Copy a box below, paste it into a page of your
          site, and your classes, calendar or court booking appear there — always up to date,
          because they come straight from ClubMode.
        </p>
        <div className="mt-8">
          <EmbedSettings />
        </div>
      </div>
    </div>
  );
}

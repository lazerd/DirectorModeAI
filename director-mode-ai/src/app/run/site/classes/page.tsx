import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ClassList from './ClassList';

/**
 * Classes — the screen that replaces paying a developer every season.
 *
 * Everything a director changes between terms lives here, editable in place:
 * the dates, the skip dates, the prices, the days of the week. Behind /run,
 * which middleware already gates, so no new protected path is needed.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Classes — ClubMode',
  description: 'Dates, skip dates and prices for every class you run.',
};

export default async function ClassesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/site/classes');

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-4xl">
        <Link href="/run/site" className="text-sm text-white/50 hover:text-white">
          ← Club site
        </Link>
        <h1 className="mt-3 font-display text-3xl text-white">Classes</h1>
        <p className="mt-1 text-white/50">
          Change a date or a price here and your website, your sign-up form and your confirmation
          emails all follow.
        </p>
        <div className="mt-8">
          <ClassList />
        </div>
      </div>
    </div>
  );
}

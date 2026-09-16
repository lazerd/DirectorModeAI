import Link from 'next/link';
import { requireCrmForPage } from '@/lib/crm/server';
import NewOrgForm from './NewOrgForm';

/**
 * /crm/new — get a club into the pipeline.
 *
 * Deliberately short. Everything except the name is editable on the org page
 * thirty seconds later, and a long form is how a prospect heard about on a
 * Tuesday never gets written down at all.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Add a club',
  robots: { index: false, follow: false },
};

export default async function NewOrgPage() {
  const ctx = await requireCrmForPage('/crm/new');
  return (
    <div className="min-h-screen bg-[#001820] px-4 py-6 text-white sm:px-6 md:px-10">
      <div className="mx-auto max-w-lg">
        <Link href="/crm" className="text-sm text-white/40 hover:text-white">
          ← Pipeline
        </Link>
        <h1 className="mt-3 font-display text-2xl text-white sm:text-3xl">Add a club</h1>
        <p className="mt-1 text-sm text-white/45">
          The name is all you need. Everything else you can fill in from the club&rsquo;s own page
          once it is here.
        </p>
        <NewOrgForm repEmail={ctx.repEmail} today={ctx.today} />
      </div>
    </div>
  );
}

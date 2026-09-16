import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireCrmForPage } from '@/lib/crm/server';
import { loadOrg, loadTemplates } from '@/lib/crm/load';
import { postalAddress } from '@/lib/crm/send';
import OrgDetail from './OrgDetail';

/**
 * /crm/[id] — one prospect club.
 *
 * Everything on this page is editable in place and saves on blur, the way
 * /run/site does. A Save button on a screen a rep opens forty times to change
 * one date is a screen where work gets lost.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Prospect',
  robots: { index: false, follow: false },
};

export default async function CrmOrgPage({ params }: { params: { id: string } }) {
  const ctx = await requireCrmForPage(`/crm/${params.id}`);
  const bundle = await loadOrg(ctx.db, params.id);
  // A CRM user asking for an org that is not there gets the same not-found as
  // anybody else asking for the page at all.
  if (!bundle) notFound();

  const templates = await loadTemplates(ctx.db);

  return (
    <div className="min-h-screen bg-[#001820] px-4 py-6 text-white sm:px-6 md:px-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/crm" className="text-sm text-white/40 hover:text-white">
          ← Pipeline
        </Link>
        <OrgDetail
          org={bundle.org}
          contacts={bundle.contacts}
          activities={bundle.activities}
          templates={templates}
          today={ctx.today}
          repEmail={ctx.repEmail}
          /* Whether cold email may go out at all, decided server-side. */
          canEmail={!!postalAddress()}
        />
      </div>
    </div>
  );
}

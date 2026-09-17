import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireCrmForPage } from '@/lib/crm/server';
import { loadOrg, loadReps, loadScheduled, loadTemplates } from '@/lib/crm/load';
import { firstNameOf } from '@/lib/crm/compose';
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

  const [templates, scheduled, reps] = await Promise.all([
    loadTemplates(ctx.db),
    loadScheduled(ctx.db, bundle.org.id),
    loadReps(ctx.db),
  ]);

  /*
   * Templates are shared between the two reps, and the composer says so by
   * name — "Kevin sees this too" lands where "shared with your team" does not.
   * Null when there is only one of them, and the composer says it differently.
   */
  const other = reps.find((r) => r.email.toLowerCase() !== ctx.repEmail);
  const otherRepName = other ? firstNameOf(other.full_name) || other.email : null;

  return (
    <div className="min-h-screen bg-[#001820] px-4 pb-10 pt-20 text-white sm:px-6 md:px-10 md:pt-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/crm" className="text-sm text-white/40 hover:text-white">
          ← Pipeline
        </Link>
        <OrgDetail
          org={bundle.org}
          contacts={bundle.contacts}
          activities={bundle.activities}
          templates={templates}
          scheduled={scheduled}
          today={ctx.today}
          repEmail={ctx.repEmail}
          otherRepName={otherRepName}
          /* Whether cold email may go out at all, decided server-side. */
          canEmail={!!postalAddress()}
        />
      </div>
    </div>
  );
}

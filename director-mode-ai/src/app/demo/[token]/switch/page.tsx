/**
 * "You're signed in as X. Continue into the demo?"
 *
 * The enter route sends a browser here when it is signed in to a real account
 * (or borrowing one through view as). Entering the demo replaces that session,
 * so it is said out loud and confirmed. Continue is a same-site POST back to
 * the enter route; Cancel goes back to the tour untouched.
 */

import { redirect } from 'next/navigation';
import { createClient as createSsrClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { getLiveDemoLink } from '@/lib/demo/server';
import { demoLanding, parseDemoRole } from '@/lib/demo/nextPath';
import DemoExpired from '../../DemoExpired';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Continue into the demo? — ClubMode', robots: { index: false } };

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ as?: string; next?: string }>;
};

export default async function DemoSwitchPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const link = await getLiveDemoLink(token);
  if (!link) return <DemoExpired />;
  const role = parseDemoRole(sp.as);
  if (!role) redirect(`/demo/${link.token}`);
  const next = demoLanding(role, sp.next);

  const supabase = await createSsrClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Nobody signed in any more (another tab signed out): nothing to confirm.
  if (!user) redirect(`/demo/${link.token}/enter?as=${role}&next=${encodeURIComponent(next)}`);

  const { data: profile } = await getSupabaseAdmin().from('profiles').select('full_name').eq('id', user.id).maybeSingle();
  const name = (profile as { full_name?: string | null } | null)?.full_name;
  const who = name ? `${name} (${user.email})` : user.email || 'another account';

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f1ea] px-4 py-16 text-[#1c2321]">
      <div className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-lg sm:p-10">
        <h1 className="text-3xl font-bold leading-tight">You&apos;re signed in as {who}.</h1>
        <p className="mt-4 text-xl leading-relaxed">
          Continue into the demo? This signs you out of your own account.
        </p>
        <form method="post" action={`/demo/${link.token}/enter`} className="mt-8 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="as" value={role} />
          <input type="hidden" name="next" value={next} />
          <button
            type="submit"
            className="min-h-[56px] rounded-2xl bg-[#14532d] px-6 py-3 text-lg font-bold text-white"
          >
            Continue
          </button>
          <a
            href={`/demo/${link.token}`}
            className="flex min-h-[56px] items-center justify-center rounded-2xl border-2 border-[#1c2321]/30 px-6 py-3 text-lg font-bold"
          >
            Cancel
          </a>
        </form>
      </div>
    </div>
  );
}

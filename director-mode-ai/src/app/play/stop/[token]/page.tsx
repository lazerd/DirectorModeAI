import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import StopClient from './StopClient';

/**
 * "Stop emails about games that need players" — the link at the bottom of
 * every CourtConnect invite. One click turns it off.
 *
 * The switch happens from the page's own script rather than on the GET, so a
 * mail scanner that opens every link in an inbox does not silently stop a
 * member's emails.
 */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'CourtConnect emails', robots: { index: false, follow: false } };

export default async function StopPage({ params }: { params: { token: string } }) {
  const ok = /^[a-f0-9]{32,64}$/.test(params.token || '');
  const { data } = ok
    ? await getSupabaseAdmin()
        .from('pf_member_prefs')
        .select('club_id, cc_clubs(name)')
        .eq('stop_token', params.token)
        .maybeSingle()
    : { data: null };

  if (!data) {
    return (
      <main className="min-h-screen bg-slate-50 px-5 py-12 text-slate-900">
        <div className="mx-auto max-w-xl">
          <h1 className="text-3xl font-bold">Link not recognized</h1>
          <p className="mt-3 text-lg text-slate-600">You can change game emails any time from CourtConnect in your club&rsquo;s app.</p>
        </div>
      </main>
    );
  }
  const c = (data as { cc_clubs: { name: string } | { name: string }[] | null }).cc_clubs;
  const clubName = (Array.isArray(c) ? c[0]?.name : c?.name) || 'your club';
  return <StopClient token={params.token} clubName={clubName} />;
}

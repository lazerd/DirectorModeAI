/**
 * Season Builder — the PUBLIC link, for the club newsletter and Constant
 * Contact. The person types their name + email and is matched to PlayerVault.
 */
import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CAMPAIGN_COLS } from '@/lib/seasonBuilder/server';
import type { Campaign } from '@/lib/seasonBuilder/shared';
import SeasonForm from '../../SeasonForm';
import { Closed, NotFound } from '../../Closed';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'USTA team sign-up' };

export default async function SeasonPublicPage({ params }: { params: { token: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) return <NotFound />;
  const db = getSupabaseAdmin();
  const { data: c } = await db.from('sb_campaigns').select(CAMPAIGN_COLS).eq('public_token', params.token).maybeSingle();
  const campaign = c as Campaign | null;
  if (!campaign) return <NotFound />;
  const { data: club } = await db.from('cc_clubs').select('name').eq('id', campaign.club_id).maybeSingle();
  if (campaign.status === 'closed') return <Closed clubName={club?.name || ''} />;
  return (
    <SeasonForm
      campaign={campaign}
      clubName={club?.name || ''}
      postUrl={`/api/season/join/${params.token}`}
      person={null}
      initial={null}
      initialGender={null}
    />
  );
}

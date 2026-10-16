/**
 * Season Builder — the personal link from the email. No login: the token is
 * the credential and names exactly one PlayerVault person on one campaign.
 */
import type { Metadata } from 'next';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { CAMPAIGN_COLS, rowToAnswer } from '@/lib/seasonBuilder/server';
import type { Campaign } from '@/lib/seasonBuilder/shared';
import SeasonForm from '../SeasonForm';
import { Closed, NotFound } from '../Closed';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'USTA team sign-up' };

export default async function SeasonInvitePage({ params }: { params: { token: string } }) {
  if (!/^[a-f0-9]{32}$/.test(params.token)) return <NotFound />;
  const db = getSupabaseAdmin();
  const { data: invite } = await db
    .from('sb_invites')
    .select('id, campaign_id, vault_player_id, name')
    .eq('token', params.token)
    .maybeSingle();
  if (!invite) return <NotFound />;
  const [{ data: c }, { data: resp }, { data: vault }] = await Promise.all([
    db.from('sb_campaigns').select(CAMPAIGN_COLS).eq('id', invite.campaign_id).maybeSingle(),
    db.from('sb_responses').select('*').eq('invite_id', invite.id).maybeSingle(),
    invite.vault_player_id
      ? db.from('cc_vault_players').select('gender').eq('id', invite.vault_player_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const campaign = c as Campaign | null;
  if (!campaign) return <NotFound />;
  const { data: club } = await db.from('cc_clubs').select('name').eq('id', campaign.club_id).maybeSingle();
  if (campaign.status === 'closed') return <Closed clubName={club?.name || ''} />;
  const g = (vault as { gender?: string } | null)?.gender;
  return (
    <SeasonForm
      campaign={campaign}
      clubName={club?.name || ''}
      postUrl={`/api/season/${params.token}`}
      person={{ name: invite.name }}
      initial={resp ? rowToAnswer(resp) : null}
      initialGender={g === 'female' || g === 'male' ? g : null}
    />
  );
}

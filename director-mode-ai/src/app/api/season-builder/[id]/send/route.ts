/**
 * Send the Season Builder email.
 *   POST { mode: 'preview' }  -> subject, sample HTML, who it will go to. Sends nothing.
 *   POST { mode: 'test' }     -> one copy to the signed-in director.
 *   POST { mode: 'live' }     -> sends the NEXT chunk to people not yet emailed and
 *                                returns { sent, failed, remaining }. The page calls
 *                                it until remaining is 0, so a 600-person send never
 *                                outlives one serverless function.
 * Re-running live later only reaches people added to PlayerVault since — nobody
 * is emailed twice. There is no reminder mode, on purpose.
 */
import { NextResponse } from 'next/server';
import { staffCampaign } from '@/lib/seasonBuilder/staff';
import { firstName, personalLink, publicLink, recipients } from '@/lib/seasonBuilder/server';
import { inviteHtml, inviteSubject } from '@/lib/seasonBuilder/emails';
import { sendBilledEmail, sendBilledEmails } from '@/lib/email';
import { CreditLimitError } from '@/lib/billing';
import { blockIfDemo } from '@/lib/demo/server';

export const maxDuration = 60;
const CHUNK = 30;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await staffCampaign(params.id);
  if ('error' in ctx) return ctx.error;
  const { db, campaign, user, club } = ctx;
  const body = await req.json().catch(() => ({}));
  const mode = body.mode;

  const { data: clubRow } = await db.from('cc_clubs').select('name, slug, email').eq('id', club.id).maybeSingle();
  const clubName = (clubRow as any)?.name || club.name;
  const replyTo = (clubRow as any)?.email || undefined;

  if (mode === 'preview') {
    const list = await recipients(db, campaign.club_id);
    const { data: sentRows } = await db.from('sb_invites').select('vault_player_id').eq('campaign_id', campaign.id).not('sent_at', 'is', null);
    const sentIds = new Set((sentRows || []).map((r: any) => r.vault_player_id));
    const toSend = list.filter((r) => !sentIds.has(r.vault_player_id));
    const byEmail = new Map<string, number>();
    for (const r of list) byEmail.set(r.email, (byEmail.get(r.email) || 0) + 1);
    const sample = toSend[0] || list[0];
    return NextResponse.json({
      subject: inviteSubject(campaign, firstName(sample?.name || 'Pat Member')),
      fromName: clubName,
      replyTo: replyTo || null,
      html: inviteHtml(campaign, clubName, firstName(sample?.name || 'Pat Member'), publicLink(campaign.public_token)),
      total: list.length,
      already_sent: list.length - toSend.length,
      to_send: toSend.length,
      shared_inboxes: [...byEmail.values()].filter((n) => n > 1).length,
      names: toSend.map((r) => r.name),
    });
  }

  const demo = await blockIfDemo(user.id);
  if (demo) return demo;

  if (mode === 'test') {
    if (!user.email) return NextResponse.json({ error: 'Your login has no email.' }, { status: 400 });
    const { data: me } = await db.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    try {
      const r = await sendBilledEmail(user.id, {
        to: user.email,
        subject: `[TEST] ${inviteSubject(campaign, firstName((me as any)?.full_name))}`,
        html: inviteHtml(campaign, clubName, firstName((me as any)?.full_name), publicLink(campaign.public_token)),
        fromName: clubName,
        replyTo,
        clubId: club.id,
        clubSlug: (clubRow as any)?.slug,
      });
      return NextResponse.json({ ok: r.sent, to: user.email, error: r.sent ? undefined : (r as any).reason });
    } catch (e) {
      if (e instanceof CreditLimitError) return NextResponse.json({ error: 'Out of email credits for this month.' }, { status: 402 });
      throw e;
    }
  }

  if (mode !== 'live') return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });

  // Make sure everyone eligible has an invite row (and so a link), then send the next chunk.
  const list = await recipients(db, campaign.club_id);
  if (list.length) {
    const { error } = await db.from('sb_invites').upsert(
      list.map((r) => ({ campaign_id: campaign.id, vault_player_id: r.vault_player_id, name: r.name, email: r.email })),
      { onConflict: 'campaign_id,vault_player_id', ignoreDuplicates: true },
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const { data: pending } = await db
    .from('sb_invites')
    .select('id, name, email, token')
    .eq('campaign_id', campaign.id)
    .is('sent_at', null)
    .is('send_error', null)
    .order('name')
    .limit(CHUNK);
  const batch = (pending || []) as { id: string; name: string; email: string; token: string }[];

  let results;
  try {
    results = await sendBilledEmails(
      user.id,
      batch.map((i) => ({
        to: i.email,
        subject: inviteSubject(campaign, firstName(i.name)),
        html: inviteHtml(campaign, clubName, firstName(i.name), personalLink(i.token)),
        fromName: clubName,
        replyTo,
        clubId: club.id,
        clubSlug: (clubRow as any)?.slug,
      })),
    );
  } catch (e) {
    if (e instanceof CreditLimitError) return NextResponse.json({ error: 'Out of email credits for this month.' }, { status: 402 });
    throw e;
  }

  const now = new Date().toISOString();
  let sent = 0, failed = 0;
  await Promise.all(
    batch.map((inv, k) => {
      const r = results[k];
      if (r?.sent) {
        sent++;
        return db.from('sb_invites').update({ sent_at: now }).eq('id', inv.id);
      }
      failed++;
      // An unsubscribed person is "done" too — recorded so we never retry them.
      return db.from('sb_invites').update({ send_error: (r as any)?.reason || 'error' }).eq('id', inv.id);
    }),
  );
  if (sent && campaign.status === 'draft') {
    await db.from('sb_campaigns').update({ status: 'sent', sent_at: now }).eq('id', campaign.id);
  }
  const { count: remaining } = await db
    .from('sb_invites')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id)
    .is('sent_at', null)
    .is('send_error', null);
  return NextResponse.json({ sent, failed, remaining: remaining ?? 0 });
}

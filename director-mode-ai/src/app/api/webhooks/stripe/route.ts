/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook endpoint. Handles:
 *   - checkout.session.completed → mark Quad entry paid + assign to flight or waitlist
 *   - account.updated            → keep Connect onboarding flags fresh
 *
 * The webhook secret is STRIPE_WEBHOOK_SECRET (platform-account webhook).
 * Run `stripe listen --forward-to localhost:3000/api/webhooks/stripe` for local dev.
 */

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { sendQuadsConfirmEmail, sendQuadsWaitlistEmail } from '@/lib/quadEmails';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) {
    return NextResponse.json({ error: 'Missing signature or secret' }, { status: 400 });
  }

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err: any) {
    return NextResponse.json({ error: `Bad signature: ${err.message}` }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const quadEntryId = session.metadata?.quad_entry_id;
    const tournamentEntryId = session.metadata?.tournament_entry_id;

    if (tournamentEntryId) {
      // Generic tournament_entries flow (RR / single-elim / FMLC / FFIC)
      const { data: entry } = await admin
        .from('tournament_entries')
        .select('id, event_id')
        .eq('id', tournamentEntryId)
        .maybeSingle();
      if (!entry) return NextResponse.json({ received: true, note: 'Tournament entry not found' });

      const { data: ev } = await admin
        .from('events')
        .select('max_players, name, slug, event_date')
        .eq('id', (entry as any).event_id)
        .maybeSingle();
      const maxPlayers = (ev as any)?.max_players ?? null;

      let position: 'in_draw' | 'waitlist' = 'in_draw';
      if (maxPlayers && maxPlayers > 0) {
        const { count } = await admin
          .from('tournament_entries')
          .select('*', { count: 'exact', head: true })
          .eq('event_id', (entry as any).event_id)
          .in('position', ['in_draw'])
          .neq('id', tournamentEntryId);
        if ((count ?? 0) >= maxPlayers) position = 'waitlist';
      }

      await admin
        .from('tournament_entries')
        .update({
          payment_status: 'paid',
          amount_paid_cents: session.amount_total ?? null,
          stripe_payment_intent_id:
            typeof session.payment_intent === 'string' ? session.payment_intent : null,
          position,
        })
        .eq('id', tournamentEntryId);

      try {
        const { data: full } = await admin
          .from('tournament_entries')
          .select('player_name, player_email, parent_email')
          .eq('id', tournamentEntryId)
          .maybeSingle();
        const e: any = full;
        const recipient = e?.player_email || e?.parent_email;
        if (recipient && (ev as any)?.slug) {
          const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
          const args = {
            to: recipient,
            playerName: e.player_name,
            tournamentName: (ev as any).name,
            publicUrl: `${origin}/tournaments/${(ev as any).slug}`,
          };
          if (position === 'in_draw') {
            await sendQuadsConfirmEmail({ ...args, tournamentDate: (ev as any).event_date ?? null });
          } else {
            await sendQuadsWaitlistEmail(args);
          }
        }
      } catch (err) {
        console.error('tournament confirm email failed:', err);
      }

      return NextResponse.json({ received: true, entry_id: tournamentEntryId, position });
    }

    const entryId = quadEntryId;
    if (!entryId) {
      return NextResponse.json({ received: true, note: 'Not a quad/tournament session' });
    }

    // Decide whether the entry goes to a flight or the waitlist:
    // Count how many other entries on the same event are already
    // in_flight or pending_payment (about to confirm) to honor max_players.
    const { data: entry } = await admin
      .from('quad_entries')
      .select('id, event_id')
      .eq('id', entryId)
      .maybeSingle();
    if (!entry) return NextResponse.json({ received: true, note: 'Entry not found' });

    const { data: ev } = await admin
      .from('events')
      .select('max_players')
      .eq('id', (entry as any).event_id)
      .maybeSingle();

    const maxPlayers = (ev as any)?.max_players ?? null;

    let position: 'in_flight' | 'waitlist' = 'in_flight';
    if (maxPlayers && maxPlayers > 0) {
      const { count } = await admin
        .from('quad_entries')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', (entry as any).event_id)
        .in('position', ['in_flight'])
        .neq('id', entryId);
      if ((count ?? 0) >= maxPlayers) position = 'waitlist';
    }

    await admin
      .from('quad_entries')
      .update({
        payment_status: 'paid',
        amount_paid_cents: session.amount_total ?? null,
        stripe_payment_intent_id:
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
        position,
      })
      .eq('id', entryId);

    // Fire confirmation/waitlist email (best-effort)
    try {
      const { data: full } = await admin
        .from('quad_entries')
        .select('player_name, player_email, parent_email, event:events(name, slug, event_date)')
        .eq('id', entryId)
        .maybeSingle();
      const e: any = full;
      const recipient = e?.player_email || e?.parent_email;
      if (recipient && e?.event?.slug) {
        const origin =
          process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai';
        const args = {
          to: recipient,
          playerName: e.player_name,
          tournamentName: e.event.name,
          publicUrl: `${origin}/quads/${e.event.slug}`,
        };
        if (position === 'in_flight') {
          await sendQuadsConfirmEmail({ ...args, tournamentDate: e.event.event_date ?? null });
        } else {
          await sendQuadsWaitlistEmail(args);
        }
      }
    } catch (err) {
      console.error('quad confirm email failed:', err);
    }

    return NextResponse.json({ received: true, entry_id: entryId, position });
  }

  if (event.type === 'account.updated') {
    const acct = event.data.object as Stripe.Account;
    await admin
      .from('profiles')
      .update({
        stripe_charges_enabled: !!acct.charges_enabled,
        stripe_payouts_enabled: !!acct.payouts_enabled,
        stripe_details_submitted: !!acct.details_submitted,
      })
      .eq('stripe_account_id', acct.id);
    return NextResponse.json({ received: true });
  }

  return NextResponse.json({ received: true });
}

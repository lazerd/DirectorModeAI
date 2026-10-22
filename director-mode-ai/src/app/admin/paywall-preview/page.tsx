/**
 * What a club without a card sees when it sends: the add-card modal and the
 * "emails waiting" banner, rendered with a fixed status so the platform owner
 * (who is exempt and never sees the real thing) can check them.
 */

import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { isPlatformOwnerEmail } from '@/lib/platformOwner';
import { EMAIL_PRICE_CENTS, TEXT_PRICE_CENTS } from '@/config/pricing';
import SendPaywall from '@/components/billing/SendPaywall';

export const dynamic = 'force-dynamic';

export default async function PaywallPreviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/admin/paywall-preview');
  if (!isPlatformOwnerEmail(user.email)) notFound();

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <h1 className="text-3xl font-display text-white">Paywall preview</h1>
      <p className="mt-3 max-w-xl text-white/60">
        A club with no card on file just sent an email. This is the prompt they get, plus the banner that stays
        while emails are waiting. The button is inert here.
      </p>
      <SendPaywall
        preview={{
          signedIn: true,
          enforced: true,
          canSend: false,
          isOwner: true,
          held: 4,
          emailCents: EMAIL_PRICE_CENTS,
          textCents: TEXT_PRICE_CENTS,
          checkoutUrl: '#',
        }}
      />
    </div>
  );
}

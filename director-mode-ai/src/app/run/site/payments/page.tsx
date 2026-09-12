import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import PaymentSettings from './PaymentSettings';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Getting paid — ClubMode',
  description: 'Your payment link, and what is still owed.',
};

export default async function PaymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/site/payments');

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-3xl">
        <h1 className="font-display text-3xl text-white">Getting paid</h1>
        <p className="mt-1 text-white/50">
          One link, covering class sign-ups and court bookings.
        </p>
        <div className="mt-8">
          <PaymentSettings />
        </div>
      </div>
    </div>
  );
}

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import BookingList from './BookingList';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Court bookings — ClubMode',
  description: 'Who has a court, and who still owes for it.',
};

export default async function BookingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/site/bookings');

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-4xl">
        <h1 className="font-display text-3xl text-white">Court bookings</h1>
        <p className="mt-1 text-white/50">
          Everything booked through your website. These also show on the court grid.
        </p>
        <div className="mt-8">
          <BookingList />
        </div>
      </div>
    </div>
  );
}

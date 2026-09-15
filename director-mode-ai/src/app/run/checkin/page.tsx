import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import CheckinManager from './CheckinManager';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'QR check-in — ClubMode',
  description: 'Court and pool check-in signs, the live wait list, and what the check-ins say.',
};

export default async function CheckinPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/checkin');

  return (
    <div className="min-h-screen bg-[#001820] p-4 pt-20 md:p-10">
      <div className="max-w-5xl">
        <CheckinManager />
      </div>
    </div>
  );
}

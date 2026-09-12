import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import RateEditor from './RateEditor';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Court rates — ClubMode',
  description: 'What an hour of court time costs, and who may book how far ahead.',
};

export default async function CourtRatesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/run/site/courts');

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-4xl">
        <h1 className="font-display text-3xl text-white">Court rates &amp; booking</h1>
        <p className="mt-1 text-white/50">
          What an hour costs, who pays it, and how far ahead they can book.
        </p>
        <div className="mt-8">
          <RateEditor />
        </div>
      </div>
    </div>
  );
}

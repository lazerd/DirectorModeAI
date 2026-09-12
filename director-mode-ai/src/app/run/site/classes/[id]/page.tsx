import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import ClassDetail from './ClassDetail';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Class — ClubMode',
};

export default async function ClassDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/run/site/classes/${id}`);

  return (
    <div className="min-h-screen bg-[#001820] p-6 md:p-10">
      <div className="max-w-4xl">
        <ClassDetail id={id} />
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { resolvePlayingClub } from '@/lib/partnerFinder/server';
import GamesBoard from '@/components/partnerFinder/GamesBoard';

// Find a Game — post a game that needs players, or join one. The member-side
// face of Partner Finder. Middleware already requires a signed-in account here.

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Find a Game' };

export default async function MemberGamesPage({ searchParams }: { searchParams: { club?: string } }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?redirect=/member/games');

  const found = await resolvePlayingClub(getSupabaseAdmin(), user.id, searchParams.club ?? null);
  if (!found) redirect('/member');
  const { club } = found;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-gradient-to-br from-emerald-700 to-teal-700 text-white">
        {/* pt-20 below md: ClubSidebar's fixed menu button sits at top-3 left-3 on phones. */}
        <div className="mx-auto max-w-3xl px-5 pb-8 pt-20 md:pt-8">
          <Link href="/member" className="inline-flex min-h-[44px] items-center gap-2 text-lg text-emerald-50 hover:underline">
            <ArrowLeft className="h-5 w-5" /> {club.name}
          </Link>
          <h1 className="mt-2 text-4xl font-bold">Find a Game</h1>
          <p className="mt-2 text-xl text-emerald-50">
            Need a player? Post your game and we&rsquo;ll email members at your level. Want a game? Tap &ldquo;I&rsquo;m in.&rdquo;
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-8">
        <GamesBoard clubId={club.id} />
      </main>
    </div>
  );
}

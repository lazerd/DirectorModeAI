import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ClipboardList, Users, Settings, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

/**
 * Auth layout for the captain-facing app only. It lives in the (app) route
 * group so it does NOT wrap the tokenized player pages
 * (/captain/availability, /captain/claim, /captain/confirm), which must stay
 * reachable without a login.
 */
export default async function CaptainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login?redirect=/captain');

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (
    <div className="min-h-screen bg-[#001820]">
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-[#002838] border-r border-white/[0.06]">
        <div className="p-5 border-b border-white/[0.06]">
          <Link href="/captain" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#D3FB52]/20 flex items-center justify-center">
              <ClipboardList size={18} className="text-[#D3FB52]" />
            </div>
            <div>
              <span className="font-display text-lg block leading-tight text-white">CaptainMode</span>
              <span className="text-xs text-white/40">Run your team</span>
            </div>
          </Link>
        </div>

        <div className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#D3FB52]/10 flex items-center justify-center">
              <span className="text-[#D3FB52] font-semibold">
                {profile?.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-sm text-white">
                {profile?.full_name || 'Captain'}
              </div>
              <div className="text-xs text-white/40 truncate">{user.email}</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3">
          <ul className="space-y-1">
            <NavItem href="/captain" icon={Users}>
              My Teams
            </NavItem>
            <NavItem href="/captain/subscribe" icon={Settings}>
              Subscription
            </NavItem>
          </ul>
        </nav>

        <div className="p-4 border-t border-white/[0.06]">
          <Link
            href="/"
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
          >
            <Zap size={18} />
            Back to ClubMode
          </Link>
        </div>
      </aside>

      <main className="md:ml-64 pt-16 md:pt-0 min-h-screen">{children}</main>
    </div>
  );
}

function NavItem({
  href,
  icon: Icon,
  children,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center gap-3 px-4 py-2.5 text-white/60 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
      >
        <Icon size={20} />
        <span className="font-medium">{children}</span>
      </Link>
    </li>
  );
}

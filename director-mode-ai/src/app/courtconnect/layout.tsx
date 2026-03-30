import Link from 'next/link';
import { Users, Home, CalendarPlus, UserCircle, Globe, Zap, Database } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import CourtConnectMobileNav from '@/components/courtconnect/CourtConnectMobileNav';

export default async function CourtConnectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirect=/courtconnect/home');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (
    <div className="min-h-screen bg-[#001820] flex">
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-[#002838] border-r border-white/[0.06]">
        {/* Logo */}
        <div className="p-5 border-b border-white/[0.06]">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Users size={18} className="text-emerald-400" />
            </div>
            <div>
              <span className="font-display text-lg block leading-tight text-white">CourtConnect</span>
              <span className="text-xs text-white/40">Player Matching</span>
            </div>
          </Link>
        </div>

        {/* User */}
        <div className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-400/10 flex items-center justify-center">
              <span className="text-emerald-400 font-semibold">
                {profile?.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-sm text-white">
                {profile?.full_name || 'Player'}
              </div>
              <div className="text-xs text-white/40 truncate">{user.email}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          <ul className="space-y-1">
            <NavItem href="/courtconnect/home" icon={Home}>
              Dashboard
            </NavItem>
            <NavItem href="/courtconnect/events" icon={Globe}>
              Event Board
            </NavItem>
            <NavItem href="/courtconnect/events/new" icon={CalendarPlus}>
              Create Event
            </NavItem>
            <NavItem href="/courtconnect/players" icon={Users}>
              Players
            </NavItem>
            <NavItem href="/courtconnect/vault" icon={Database}>
              PlayerVault
            </NavItem>
            <NavItem href="/courtconnect/profile" icon={UserCircle}>
              My Profile
            </NavItem>
          </ul>
        </nav>

        {/* Back to Platform */}
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

      {/* Mobile Header */}
      <CourtConnectMobileNav
        userName={profile?.full_name || 'Player'}
        userInitial={profile?.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase() || 'P'}
      />

      {/* Main Content */}
      <main className="md:ml-64 pt-16 md:pt-0 flex-1 min-h-screen">
        {children}
      </main>
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

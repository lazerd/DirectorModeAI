import Link from 'next/link';
import { Shuffle, Home, Calendar, Settings, CreditCard, Zap, Trophy } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import MixerMobileNav from '@/components/mixer/MixerMobileNav';

export default async function MixerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirect=/mixer/home');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (
    <div className="min-h-screen bg-[#001820]">
      {/* Desktop Sidebar - hidden on mobile */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-[#002838] border-r border-white/[0.06]">
        {/* Logo */}
        <div className="p-5 border-b border-white/[0.06]">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-orange-500/20 flex items-center justify-center">
              <Shuffle size={18} className="text-orange-400" />
            </div>
            <div>
              <span className="font-display text-lg block leading-tight text-white">MixerMode</span>
              <span className="text-xs text-white/40">Events AI</span>
            </div>
          </Link>
        </div>

        {/* User */}
        <div className="p-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-400/10 flex items-center justify-center">
              <span className="text-orange-400 font-semibold">
                {profile?.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-sm text-white">
                {profile?.full_name || 'Organizer'}
              </div>
              <div className="text-xs text-white/40 truncate">{user.email}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          <ul className="space-y-1">
            <NavItem href="/mixer/home" icon={Home}>
              My Events
            </NavItem>
            <NavItem href="/mixer/select-format" icon={Calendar}>
              Create Event
            </NavItem>
            <NavItem href="/mixer/leagues" icon={Trophy}>
              Leagues
            </NavItem>
            <NavItem href="/mixer/subscription" icon={CreditCard}>
              Subscription
            </NavItem>
            <NavItem href="/mixer/settings" icon={Settings}>
              Settings
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
      <MixerMobileNav
        userName={profile?.full_name || 'Organizer'}
        userInitial={profile?.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase() || 'U'}
      />

      {/* Main Content - with left margin on desktop for sidebar */}
      <main className="md:ml-64 pt-16 md:pt-0 min-h-screen">
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

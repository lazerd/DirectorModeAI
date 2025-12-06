import Link from 'next/link';
import { Shuffle, Home, Calendar, Settings, Trophy, CreditCard, Menu } from 'lucide-react';
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
    <div className="min-h-screen bg-gray-50">
      {/* Desktop Sidebar - hidden on mobile */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 bg-white border-r border-gray-200">
        {/* Logo */}
        <div className="p-5 border-b border-gray-200">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-mixer flex items-center justify-center">
              <Shuffle size={18} className="text-white" />
            </div>
            <div>
              <span className="font-display text-lg block leading-tight">MixerMode</span>
              <span className="text-xs text-gray-500">Events AI</span>
            </div>
          </Link>
        </div>

        {/* User */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-mixer-light flex items-center justify-center">
              <span className="text-mixer font-semibold">
                {profile?.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-sm">
                {profile?.full_name || 'Organizer'}
              </div>
              <div className="text-xs text-gray-500 truncate">{user.email}</div>
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
            <NavItem href="/mixer/subscription" icon={CreditCard}>
              Subscription
            </NavItem>
            <NavItem href="/mixer/settings" icon={Settings}>
              Settings
            </NavItem>
          </ul>
        </nav>

        {/* Back to Platform */}
        <div className="p-4 border-t border-gray-200">
          <Link
            href="/"
            className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
          >
            <Trophy size={18} />
            Back to Platform
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
        className="flex items-center gap-3 px-4 py-2.5 text-gray-600 hover:bg-gray-100 rounded-xl transition-colors"
      >
        <Icon size={20} />
        <span className="font-medium">{children}</span>
      </Link>
    </li>
  );
}

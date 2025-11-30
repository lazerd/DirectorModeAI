import Link from 'next/link';
import { Clock, Calendar, Users, Mail, History, Settings, Trophy } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function LessonsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login?redirect=/lessons/dashboard');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-gray-200">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-lessons flex items-center justify-center">
              <Clock size={18} className="text-white" />
            </div>
            <div>
              <span className="font-display text-lg block leading-tight">LastMinute</span>
              <span className="text-xs text-gray-500">Lesson Mode</span>
            </div>
          </Link>
        </div>

        {/* User */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-lessons-light flex items-center justify-center">
              <span className="text-lessons font-semibold">
                {profile?.full_name?.charAt(0) || user.email?.charAt(0)?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-sm">
                {profile?.full_name || 'Coach'}
              </div>
              <div className="text-xs text-gray-500 truncate">{user.email}</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3">
          <ul className="space-y-1">
            <NavItem href="/lessons/dashboard" icon={Calendar}>
              My Calendar
            </NavItem>
            <NavItem href="/lessons/clients" icon={Users}>
              Clients
            </NavItem>
            <NavItem href="/lessons/blast" icon={Mail}>
              Email Blast
            </NavItem>
            <NavItem href="/lessons/history" icon={History}>
              History
            </NavItem>
            <NavItem href="/lessons/settings" icon={Settings}>
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

      {/* Main Content */}
      <main className="flex-1">
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

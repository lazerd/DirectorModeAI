'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Shuffle, Home, Calendar, Settings, Zap, CreditCard, Menu, X, Trophy } from 'lucide-react';

interface MixerMobileNavProps {
  userName: string;
  userInitial: string;
}

export default function MixerMobileNav({ userName, userInitial }: MixerMobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Mobile Header Bar */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-16 bg-[#002838] border-b border-white/[0.06] flex items-center justify-between px-4 z-50">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <Shuffle size={16} className="text-orange-400" />
          </div>
          <span className="font-display text-base text-white">MixerMode</span>
        </Link>

        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 hover:bg-white/10 rounded-lg text-white/70"
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div className="md:hidden fixed inset-0 z-40 pt-16">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setIsOpen(false)}
          />

          <div className="absolute top-16 right-0 w-64 bg-[#002838] h-[calc(100vh-4rem)] border-l border-white/[0.06] overflow-y-auto">
            <div className="p-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-400/10 flex items-center justify-center">
                  <span className="text-orange-400 font-semibold">{userInitial}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-sm text-white">{userName}</div>
                </div>
              </div>
            </div>

            <nav className="p-3">
              <ul className="space-y-1">
                <MobileNavItem href="/mixer/home" icon={Home} onClick={() => setIsOpen(false)}>
                  My Events
                </MobileNavItem>
                <MobileNavItem href="/mixer/select-format" icon={Calendar} onClick={() => setIsOpen(false)}>
                  Create Event
                </MobileNavItem>
                <MobileNavItem href="/mixer/leagues" icon={Trophy} onClick={() => setIsOpen(false)}>
                  Leagues
                </MobileNavItem>
                <MobileNavItem href="/mixer/subscription" icon={CreditCard} onClick={() => setIsOpen(false)}>
                  Subscription
                </MobileNavItem>
                <MobileNavItem href="/mixer/settings" icon={Settings} onClick={() => setIsOpen(false)}>
                  Settings
                </MobileNavItem>
              </ul>
            </nav>

            <div className="p-4 border-t border-white/[0.06] mt-auto">
              <Link
                href="/"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
              >
                <Zap size={18} />
                Back to ClubMode
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MobileNavItem({
  href,
  icon: Icon,
  children,
  onClick,
}: {
  href: string;
  icon: React.ElementType;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <li>
      <Link
        href={href}
        onClick={onClick}
        className="flex items-center gap-3 px-4 py-3 text-white/60 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
      >
        <Icon size={20} />
        <span className="font-medium">{children}</span>
      </Link>
    </li>
  );
}

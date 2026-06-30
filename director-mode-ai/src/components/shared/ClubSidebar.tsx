'use client';

/**
 * ClubSidebar — a QuickBooks-style collapsible left navigation rail.
 *
 * Drop <ClubSidebar /> at the top of any tool page that otherwise has no way
 * back to the home page or across to the other tools (e.g. /flex, /benchmarks).
 * It's a fixed, brand-styled (dark teal + lime) app shell that:
 *   - shows every tool with an icon + label, highlighting the active one
 *   - collapses to a thin icon rail (toggle persisted to localStorage)
 *   - becomes an off-canvas drawer on phones, opened by a floating button
 *   - shifts page content right via body padding so nothing is hidden behind it
 *
 * It is intentionally self-contained (no Supabase / auth coupling) so it can be
 * mounted on server-rendered or public pages without extra wiring.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Zap, Home, LayoutGrid, Trophy, Shuffle, Clock, Wrench, Users, Database,
  Waves, GraduationCap, ListOrdered, BarChart3, Sparkles, ExternalLink,
  ChevronLeft, ChevronRight, Menu, X,
} from 'lucide-react';

type Item = {
  name: string;
  href: string;
  /** path prefix used to decide the active item (defaults to href) */
  match?: string;
  icon: typeof Home;
  color: string;
  external?: boolean;
};

// Mirrors the tool list on the marketing home page. `match` is the longest
// path prefix that should light this item up as active.
const ITEMS: Item[] = [
  { name: 'Home', href: '/', match: '/', icon: Home, color: '#D3FB52' },
  { name: 'CourtSheet', href: '/courtsheet/staff', match: '/courtsheet', icon: LayoutGrid, color: '#22d3ee' },
  { name: 'Leagues & JTT', href: '/mixer/leagues', match: '/mixer/leagues', icon: Trophy, color: '#D3FB52' },
  { name: 'MixerMode', href: '/mixer/home', match: '/mixer/home', icon: Shuffle, color: '#fb923c' },
  { name: 'Flex League', href: '/flex', match: '/flex', icon: ListOrdered, color: '#60a5fa' },
  { name: 'Lessons', href: '/lessons/dashboard', match: '/lessons', icon: Clock, color: '#60a5fa' },
  { name: 'Stringing', href: '/stringing/jobs', match: '/stringing', icon: Wrench, color: '#f472b6' },
  { name: 'CourtConnect', href: '/courtconnect/home', match: '/courtconnect/home', icon: Users, color: '#34d399' },
  { name: 'PlayerVault', href: '/courtconnect/vault', match: '/courtconnect/vault', icon: Database, color: '#2dd4bf' },
  { name: 'SwimMode', href: '/swim', match: '/swim', icon: Waves, color: '#38bdf8' },
  { name: 'Benchmarks', href: '/benchmarks', match: '/benchmarks', icon: BarChart3, color: '#f59e0b' },
  { name: 'Connect', href: '/connect', match: '/connect', icon: Sparkles, color: '#2dd4bf' },
  { name: 'CoachMode.ai', href: 'https://coachmode.ai', icon: GraduationCap, color: '#a78bfa', external: true },
];

const EXPANDED = 248;
const COLLAPSED = 72;

function activeHref(pathname: string): string | null {
  let best: string | null = null;
  let bestLen = -1;
  for (const it of ITEMS) {
    if (it.external) continue;
    const m = it.match ?? it.href;
    const hit = m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(m + '/') || pathname === m;
    if (hit && m.length > bestLen) { best = it.href; bestLen = m.length; }
  }
  return best;
}

export default function ClubSidebar() {
  const pathname = usePathname() || '/';
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hovering, setHovering] = useState(false); // hover-to-peek when collapsed
  const [mounted, setMounted] = useState(false);
  const active = activeHref(pathname);

  // Restore the pinned/collapsed preference before first paint of the rail.
  useEffect(() => {
    setCollapsed(localStorage.getItem('clubnav-collapsed') === '1');
    setMounted(true);
  }, []);

  // Push page content right on desktop so it isn't hidden behind the fixed rail.
  useEffect(() => {
    if (!mounted) return;
    const apply = () => {
      const desktop = window.matchMedia('(min-width: 768px)').matches;
      document.body.style.paddingLeft = desktop ? `${collapsed ? COLLAPSED : EXPANDED}px` : '';
      document.body.style.transition = 'padding-left .2s ease';
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.body.style.paddingLeft = '';
    };
  }, [collapsed, mounted]);

  // Close the mobile drawer whenever you navigate.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem('clubnav-collapsed', next ? '1' : '0');
      return next;
    });
  };

  // When collapsed, hovering the rail temporarily expands it (overlaying page
  // content) so you can see/click every tool without un-pinning.
  const peeking = collapsed && hovering && !mobileOpen;
  const showLabels = !collapsed || mobileOpen || peeking;
  const width = mobileOpen ? EXPANDED : (collapsed && !peeking) ? COLLAPSED : EXPANDED;

  return (
    <>
      {/* Floating opener — phones only */}
      <button
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        className="md:hidden fixed top-3 left-3 z-[60] w-11 h-11 rounded-xl bg-[#001016] text-white border border-white/15 shadow-lg flex items-center justify-center"
      >
        <Menu size={20} />
      </button>

      {/* Scrim — phones only, when drawer open */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
        />
      )}

      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{ width, fontFamily: "'Inter', system-ui, sans-serif" }}
        className={[
          'fixed top-0 left-0 h-screen z-[70] flex flex-col',
          'bg-[#001016] text-white border-r border-white/10 shadow-2xl shadow-black/40',
          'transition-[width,transform] duration-200 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
        ].join(' ')}
      >
        {/* Brand / Home */}
        <div className="flex items-center gap-2.5 px-4 h-16 shrink-0 border-b border-white/[0.07]">
          <Link href="/" className="flex items-center gap-2.5 min-w-0 group">
            <div className="w-9 h-9 shrink-0 bg-[#D3FB52] rounded-xl flex items-center justify-center shadow-lg shadow-[#D3FB52]/20 group-hover:scale-105 transition-transform">
              <Zap className="text-[#002838]" size={18} />
            </div>
            {showLabels && (
              <span className="font-bold text-[17px] tracking-tight truncate">
                ClubMode<span className="text-[#D3FB52]"> AI</span>
              </span>
            )}
          </Link>
          {/* Close (mobile) */}
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="md:hidden ml-auto p-2 text-white/50 hover:text-white rounded-lg"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tools */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-1">
          {ITEMS.map((it) => {
            const Icon = it.icon;
            const isActive = !it.external && it.href === active;
            const inner = (
              <>
                <span
                  className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center transition-colors"
                  style={{
                    background: isActive ? `${it.color}22` : 'transparent',
                  }}
                >
                  <Icon size={19} style={{ color: isActive ? it.color : undefined }} className={isActive ? '' : 'text-white/60 group-hover:text-white'} />
                </span>
                {showLabels && (
                  <span className={`truncate text-[14px] font-medium ${isActive ? 'text-white' : 'text-white/70 group-hover:text-white'}`}>
                    {it.name}
                  </span>
                )}
                {showLabels && it.external && <ExternalLink size={13} className="ml-auto text-white/30" />}
              </>
            );
            const cls = [
              'group relative flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors',
              isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.05]',
              collapsed && !mobileOpen && !peeking ? 'justify-center' : '',
            ].join(' ');

            return it.external ? (
              <a key={it.name} href={it.href} target="_blank" rel="noopener noreferrer" className={cls} title={collapsed && !mobileOpen && !peeking ? it.name : undefined}>
                {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-[#D3FB52]" />}
                {inner}
              </a>
            ) : (
              <Link key={it.name} href={it.href} className={cls} title={collapsed && !mobileOpen && !peeking ? it.name : undefined}>
                {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-[#D3FB52]" />}
                {inner}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle — desktop only */}
        <div className="hidden md:block border-t border-white/[0.07] p-2.5">
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-white/50 hover:text-white hover:bg-white/[0.05] transition-colors"
          >
            {collapsed ? <ChevronRight size={18} className="mx-auto" /> : <><ChevronLeft size={18} /><span className="text-[13px] font-medium">Collapse</span></>}
          </button>
        </div>
      </aside>
    </>
  );
}

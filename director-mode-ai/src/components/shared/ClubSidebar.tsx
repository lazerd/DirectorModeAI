'use client';

/**
 * ClubSidebar — a QuickBooks-style collapsible left navigation rail.
 *
 * Mounted ONCE globally in the root layout (src/app/layout.tsx), so it appears
 * on every page. Do not also mount it per-page (you'd get two overlapping rails).
 * It's a fixed, brand-styled (dark teal + lime) app shell that:
 *   - shows the three audience spaces from src/config/nav.ts
 *   - collapses to a thin icon rail (toggle persisted to localStorage)
 *   - becomes an off-canvas drawer on phones, opened by a floating button
 *   - shifts page content right via body padding so nothing is hidden behind it
 *
 * NAV STRUCTURE (see src/config/nav.ts for the full rationale):
 *   "Run the club" — five plain-English sections + All tools. Each section item
 *                    opens a /run/* landing page that lists the branded tools
 *                    inside it. No tool URL changed; this is grouping only.
 *   "For players"  — the member-facing surfaces.
 *   "For you"      — the director's career (Benchmarks, Recruiting). Rendered in
 *                    the rail FOOTER, visually separated from club operations,
 *                    because it is a different value proposition and does not
 *                    belong in the primary nav.
 *
 * It is intentionally self-contained (no Supabase / auth coupling for the nav
 * shape itself) so it can be mounted on server-rendered or public pages.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  SECTIONS, FOR_PLAYERS, FOR_YOU, ALL_TOOLS_ITEM, activeHref, type NavIcon,
} from '@/config/nav';
import {
  Zap, Home, LayoutGrid, Calendar, GraduationCap,
  ChevronLeft, ChevronRight, Menu, X,
} from 'lucide-react';

type Item = {
  name: string;
  href: string;
  /** path prefixes used to decide the active item */
  matches: string[];
  icon: NavIcon;
  color: string;
};

type Group = { heading: string | null; items: Item[] };

/** "Run the club" (default space) + "For players". "For you" lives in the footer. */
const PRIMARY_GROUPS: Group[] = [
  {
    heading: 'Run the club',
    items: [
      ...SECTIONS.map((s) => ({
        name: s.label,
        href: s.href,
        matches: s.matches,
        icon: s.icon,
        color: s.color,
      })),
      {
        name: ALL_TOOLS_ITEM.label,
        href: ALL_TOOLS_ITEM.href,
        matches: ALL_TOOLS_ITEM.matches,
        icon: ALL_TOOLS_ITEM.icon,
        color: ALL_TOOLS_ITEM.color,
      },
    ],
  },
  {
    heading: 'For players',
    items: FOR_PLAYERS.map((t) => ({
      name: t.name,
      href: t.href,
      matches: [t.match ?? t.href],
      icon: t.icon,
      color: t.color,
    })),
  },
];

const FOOTER_ITEMS: Item[] = FOR_YOU.map((t) => ({
  name: t.name,
  href: t.href,
  matches: [t.match ?? t.href],
  icon: t.icon,
  color: t.color,
}));

const EXPANDED = 248;
const COLLAPSED = 72;

/**
 * Tokenized, login-free pages that players open from an email. They are not
 * running the club, so the director rail (and its floating phone opener) has no
 * business covering their screen.
 */
const PUBLIC_PREFIXES = [
  '/captain/availability',
  '/captain/intake',
  '/captain/claim',
  '/captain/confirm',
  '/leagues/rsvp',
  '/leagues/join',
  '/enter',
  '/pathway/p',
  '/pathway/curriculum',
];

export default function ClubSidebar() {
  const pathname = usePathname() || '/';
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hovering, setHovering] = useState(false); // hover-to-peek when collapsed
  const [mounted, setMounted] = useState(false);
  // When the signed-in user is a club MEMBER (not a director/owner), show a
  // member-appropriate nav instead of the full director toolset. null = show all.
  const [memberNav, setMemberNav] = useState<Group[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return; // guest → full nav (marketing shell)
        const { data: owned } = await supabase.from('cc_clubs').select('id').eq('owner_id', user.id).limit(1).maybeSingle();
        if (owned) return; // director/owner → full nav
        const { data: mem } = await supabase
          .from('cc_club_members')
          .select('role, cc_clubs(slug)')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();
        if (mem && (mem as any).role === 'member') {
          const slug = (mem as any).cc_clubs?.slug as string | undefined;
          setMemberNav([{
            heading: null,
            items: [
              { name: 'My Club', href: '/member', matches: ['/member'], icon: Home, color: '#22d3ee' },
              ...(slug ? [{ name: 'Book a Court', href: `/courtsheet/${slug}`, matches: ['/courtsheet'], icon: LayoutGrid, color: '#22d3ee' } as Item] : []),
              { name: 'My Account', href: '/client/dashboard', matches: ['/client/dashboard'], icon: Calendar, color: '#60a5fa' },
              { name: 'Find a Coach', href: '/find-coach', matches: ['/find-coach'], icon: GraduationCap, color: '#a78bfa' },
            ],
          }]);
        }
      } catch { /* keep full nav on any error */ }
    })();
  }, []);

  const isMember = memberNav !== null;
  const groups = memberNav ?? PRIMARY_GROUPS;
  const footerItems = isMember ? [] : FOOTER_ITEMS;
  const active = activeHref(pathname, [...groups.flatMap((g) => g.items), ...footerItems]);

  // Restore the pinned/collapsed preference before first paint of the rail.
  // Default is COLLAPSED (a thin icon rail) so the nav stays out of the way and
  // reveals every section on hover; users who pin it open are remembered.
  useEffect(() => {
    setCollapsed(localStorage.getItem('clubnav-collapsed') !== '0');
    setMounted(true);
  }, []);

  // Push page content right on desktop so it isn't hidden behind the fixed rail.
  useEffect(() => {
    if (!mounted) return;
    const apply = () => {
      const desktop = window.matchMedia('(min-width: 768px)').matches;
      document.body.style.paddingLeft = desktop && !isPublic ? `${collapsed ? COLLAPSED : EXPANDED}px` : '';
      document.body.style.transition = 'padding-left .2s ease';
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
      document.body.style.paddingLeft = '';
    };
  }, [collapsed, mounted, isPublic]);

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
  // content) so you can see/click everything without un-pinning.
  const peeking = collapsed && hovering && !mobileOpen;
  const showLabels = !collapsed || mobileOpen || peeking;
  const width = mobileOpen ? EXPANDED : (collapsed && !peeking) ? COLLAPSED : EXPANDED;

  const renderItem = (it: Item) => {
    const Icon = it.icon;
    const isActive = it.href === active;
    const cls = [
      'group relative flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors',
      isActive ? 'bg-white/[0.06]' : 'hover:bg-white/[0.05]',
      collapsed && !mobileOpen && !peeking ? 'justify-center' : '',
    ].join(' ');

    return (
      <Link
        key={it.href}
        href={it.href}
        className={cls}
        title={collapsed && !mobileOpen && !peeking ? it.name : undefined}
      >
        {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-[#D3FB52]" />}
        <span
          className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center transition-colors"
          style={{ background: isActive ? `${it.color}22` : 'transparent' }}
        >
          <Icon
            size={19}
            style={{ color: isActive ? it.color : undefined }}
            className={isActive ? '' : 'text-white/60 group-hover:text-white'}
          />
        </span>
        {showLabels && (
          <span className={`truncate text-[14px] font-medium ${isActive ? 'text-white' : 'text-white/70 group-hover:text-white'}`}>
            {it.name}
          </span>
        )}
      </Link>
    );
  };

  if (isPublic) return null;

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

        {/* Spaces */}
        <nav className="flex-1 overflow-y-auto py-3 px-2.5">
          {groups.map((group, gi) => (
            <div key={group.heading ?? `g${gi}`} className={gi > 0 ? 'mt-4 pt-4 border-t border-white/[0.07]' : ''}>
              {group.heading && (
                showLabels ? (
                  <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/30">
                    {group.heading}
                  </p>
                ) : (
                  // Collapsed rail: the heading becomes a hairline so the groups
                  // still read as separate without stealing width.
                  gi > 0 ? null : <div className="h-1" />
                )
              )}
              <div className="space-y-1">{group.items.map(renderItem)}</div>
            </div>
          ))}
        </nav>

        {/* "For you" — the director's own career, kept out of the primary nav */}
        {footerItems.length > 0 && (
          <div className="border-t border-white/[0.07] px-2.5 py-2.5">
            {showLabels && (
              <p className="px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/25">
                For you
              </p>
            )}
            <div className="space-y-1">{footerItems.map(renderItem)}</div>
          </div>
        )}

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

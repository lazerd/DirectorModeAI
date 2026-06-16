'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Shuffle, Clock, Wrench, ArrowRight, LogOut, User, Calendar,
  UserCircle, Trophy, Users, GraduationCap, Database, ExternalLink,
  Sparkles, Check, ChevronRight, Zap, BarChart3, Waves,
  LayoutGrid, ListOrdered, Radio, MapPin, Star, ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ProductShowcase from "@/components/shared/ProductShowcase";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    router.push("/");
  };

  const goToTool = (href: string) => {
    if (user) {
      router.push(href);
    } else {
      router.push("/login");
    }
  };

  const goToLessons = async () => {
    if (!user) {
      router.push("/login");
      return;
    }

    const supabase = createClient();

    const { data: coach } = await supabase
      .from('lesson_coaches')
      .select('id, slug')
      .eq('profile_id', user.id)
      .not('slug', 'is', null)
      .single();

    if (coach) {
      router.push('/lessons/dashboard');
      return;
    }

    const { data: client } = await supabase
      .from('lesson_clients')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    if (client) {
      router.push('/client/dashboard');
      return;
    }

    router.push('/find-coach');
  };

  const tools = [
    {
      name: "CourtSheet AI",
      tag: "COURTS",
      description: "The live grid of every court reservation across the club. Type or speak a command to book, move, or block.",
      icon: LayoutGrid,
      color: "text-cyan-400",
      bg: "bg-cyan-400/10",
      tagColor: "bg-cyan-400/10 text-cyan-400",
      onClick: () => goToTool("/courtsheet/staff"),
    },
    {
      name: "Leagues & JTT",
      tag: "LEAGUES",
      badge: "NEW",
      description: "Run full team leagues and Junior Team Tennis — strength-ordered rosters, auto-laddering, two-site match days, and magic-link coach scoring.",
      icon: Trophy,
      color: "text-[#D3FB52]",
      bg: "bg-[#D3FB52]/10",
      tagColor: "bg-[#D3FB52]/10 text-[#D3FB52]",
      onClick: () => goToTool("/mixer/leagues"),
    },
    {
      name: "MixerMode AI",
      tag: "EVENTS",
      description: "Round robins, balanced team generation, tournaments and quads — live scores and standings across every format.",
      icon: Shuffle,
      color: "text-orange-400",
      bg: "bg-orange-400/10",
      tagColor: "bg-orange-400/10 text-orange-400",
      onClick: () => goToTool("/mixer/home"),
    },
    {
      name: "LastMinuteLesson",
      tag: "LESSONS",
      description: "Post open lesson slots, notify clients instantly, and let them book in one tap.",
      icon: Clock,
      color: "text-blue-400",
      bg: "bg-blue-400/10",
      tagColor: "bg-blue-400/10 text-blue-400",
      onClick: goToLessons,
    },
    {
      name: "StringingMode AI",
      tag: "PRO SHOP",
      description: "AI string recommendations, job tracking from drop-off to pickup, customer history, and inventory.",
      icon: Wrench,
      color: "text-pink-400",
      bg: "bg-pink-400/10",
      tagColor: "bg-pink-400/10 text-pink-400",
      onClick: () => goToTool("/stringing/jobs"),
    },
    {
      name: "CourtConnect",
      tag: "PLAYERS",
      description: "Match players by skill level, create events, and manage RSVPs with automatic waitlists.",
      icon: Users,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      tagColor: "bg-emerald-400/10 text-emerald-400",
      onClick: () => goToTool("/courtconnect/home"),
    },
    {
      name: "PlayerVault",
      tag: "ROSTER",
      description: "Club roster CRM with NTRP/UTR ratings, UTR auto-lookup, and bulk CourtConnect import.",
      icon: Database,
      color: "text-teal-400",
      bg: "bg-teal-400/10",
      tagColor: "bg-teal-400/10 text-teal-400",
      onClick: () => goToTool("/courtconnect/vault"),
    },
    {
      name: "SwimMode",
      tag: "SWIM TEAM",
      description: "Volunteer points tracker for swim team leads — define jobs, track family points all season, CSV in and out.",
      icon: Waves,
      color: "text-sky-400",
      bg: "bg-sky-400/10",
      tagColor: "bg-sky-400/10 text-sky-400",
      onClick: () => goToTool("/swim"),
    },
    {
      name: "CoachMode.ai",
      tag: "COACHING AI",
      description: "AI-powered video analysis, skill ratings, and player development — the coaching companion to your club.",
      icon: GraduationCap,
      color: "text-violet-400",
      bg: "bg-violet-400/10",
      tagColor: "bg-violet-400/10 text-violet-400",
      href: "https://coachmode.ai",
      external: true,
    },
  ];

  return (
    <div className="min-h-screen bg-[#001820] text-white antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ===================== HEADER ===================== */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-[#001820]/80 backdrop-blur-xl border-b border-white/10"
            : "bg-transparent border-b border-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-5 sm:px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 bg-[#D3FB52] rounded-xl flex items-center justify-center shadow-lg shadow-[#D3FB52]/20 group-hover:scale-105 transition-transform">
              <Zap className="text-[#002838]" size={18} />
            </div>
            <span className="font-bold text-lg tracking-tight">ClubMode<span className="text-[#D3FB52]"> AI</span></span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm text-white/60">
            <a href="#tools" className="hover:text-white transition-colors">Platform</a>
            <a href="#leagues" className="hover:text-white transition-colors">Leagues &amp; JTT</a>
            <a href="#players" className="hover:text-white transition-colors">For Players</a>
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
          </nav>

          <div className="flex items-center gap-2.5">
            {loading ? (
              <div className="w-24 h-9 bg-white/10 animate-pulse rounded-lg" />
            ) : user ? (
              <>
                <Link href="/client/dashboard" className="hidden sm:flex items-center gap-2 px-4 py-2 text-[#D3FB52] hover:bg-white/5 rounded-lg font-medium text-sm transition-colors">
                  <Calendar size={16} />
                  My Account
                </Link>
                <span className="hidden lg:flex items-center gap-2 text-white/50 px-2 text-sm">
                  <User size={15} />
                  {user.email?.split("@")[0]}
                </span>
                <button onClick={handleLogout} aria-label="Sign out" className="p-2 text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <>
                <Link href="/login" className="hidden sm:block text-white/70 hover:text-white text-sm font-medium transition-colors px-2">
                  Sign In
                </Link>
                <Link href="/login" className="px-4 sm:px-5 py-2.5 bg-[#D3FB52] text-[#002838] rounded-lg font-semibold text-sm hover:bg-[#c5f035] hover:shadow-lg hover:shadow-[#D3FB52]/25 transition-all">
                  Get Started Free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ===================== HERO ===================== */}
      <section className="relative pt-32 sm:pt-40 pb-20 sm:pb-28 px-5 sm:px-6 overflow-hidden">
        {/* Aurora background */}
        <div aria-hidden className="absolute inset-0 pointer-events-none">
          <div className="hm-aurora absolute -top-24 left-[12%] w-[36rem] h-[36rem] bg-[#D3FB52]/15 rounded-full blur-[120px]" />
          <div className="hm-aurora-slow absolute top-10 right-[8%] w-[30rem] h-[30rem] bg-emerald-500/12 rounded-full blur-[120px]" />
          <div className="hm-aurora absolute bottom-[-10rem] left-1/2 -translate-x-1/2 w-[40rem] h-[40rem] bg-cyan-500/8 rounded-full blur-[140px]" />
          <div className="absolute inset-0 opacity-[0.04] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:54px_54px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_72%)]" />
        </div>

        <div className="relative z-10 max-w-7xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-14 lg:gap-10 items-center">
          {/* Left: copy */}
          <div className="text-center lg:text-left">
            <div className="hm-fade-up inline-flex items-center gap-2 px-3.5 py-1.5 bg-white/[0.06] border border-white/10 rounded-full text-xs sm:text-sm font-medium text-white/80 mb-7 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="hm-pulse-ring absolute inline-flex h-full w-full rounded-full bg-[#D3FB52]" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#D3FB52]" />
              </span>
              New: Team Leagues &amp; Junior Team Tennis
            </div>

            <h1 className="hm-fade-up text-[2.7rem] leading-[1.05] sm:text-6xl lg:text-[4.4rem] font-bold tracking-tight mb-6" style={{ animationDelay: "0.05s" }}>
              Run your entire club
              <br />
              from <span className="hm-gradient-text">one screen.</span>
            </h1>

            <p className="hm-fade-up text-lg sm:text-xl text-white/60 mb-9 max-w-xl mx-auto lg:mx-0 leading-relaxed" style={{ animationDelay: "0.12s" }}>
              Court sheets, team leagues, junior team tennis, mixers, tournaments,
              lessons, stringing, player matching, and AI coaching — every tool your
              club needs, one login, zero spreadsheets.
            </p>

            <div className="hm-fade-up flex flex-col sm:flex-row items-center justify-center lg:justify-start gap-3.5 mb-10" style={{ animationDelay: "0.18s" }}>
              <Link
                href="/login"
                className="w-full sm:w-auto px-8 py-4 bg-[#D3FB52] text-[#002838] rounded-xl font-semibold text-base hover:bg-[#c5f035] transition-all shadow-xl shadow-[#D3FB52]/20 hover:shadow-2xl hover:shadow-[#D3FB52]/30 hover:-translate-y-0.5 inline-flex items-center justify-center gap-2"
              >
                Get Started Free <ArrowRight size={18} />
              </Link>
              <a
                href="#tools"
                className="w-full sm:w-auto px-8 py-4 border border-white/15 text-white rounded-xl font-semibold text-base hover:bg-white/5 hover:border-white/30 transition-all inline-flex items-center justify-center gap-2"
              >
                Explore the platform
              </a>
            </div>

            {/* Stat strip */}
            <div className="hm-fade-up grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 max-w-lg mx-auto lg:mx-0" style={{ animationDelay: "0.24s" }}>
              <HeroStat value="9" label="connected tools" />
              <HeroStat value="4" label="event formats" />
              <HeroStat value="All" label="racquet sports" />
              <HeroStat value="0" label="spreadsheets" />
            </div>
          </div>

          {/* Right: floating live court-sheet mockup */}
          <div className="hm-fade-up relative" style={{ animationDelay: "0.2s" }}>
            <div className="hm-float relative">
              <div aria-hidden className="absolute -inset-6 bg-[#D3FB52]/10 rounded-[2rem] blur-3xl" />
              <div
                className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50 bg-[#001016]"
                style={{ transform: "perspective(1400px) rotateY(-4deg) rotateX(2deg)" }}
              >
                {/* window chrome */}
                <div className="flex items-center gap-2 px-4 py-2.5 bg-[#0a1822] border-b border-white/[0.06]">
                  <div className="flex gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
                    <span className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
                  </div>
                  <div className="flex-1 flex justify-center">
                    <span className="bg-white/5 rounded-md px-3 py-1 text-[11px] text-white/40">club.coachmode.ai/courtsheet</span>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-[#D3FB52]">
                    <Radio size={11} /> LIVE
                  </span>
                </div>

                {/* live court grid */}
                <div className="p-4 bg-gradient-to-br from-[#001620] to-[#001016]">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold text-white/70">Today &middot; 11 courts</span>
                    <span className="text-[10px] text-white/40">4:00 PM</span>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { court: "Court 1", label: "Cardio Tennis", who: "Coach Diesel", tone: "lime", w: "78%" },
                      { court: "Court 2", label: "Singles · Sarah vs Mike", who: "Member", tone: "cyan", w: "55%" },
                      { court: "Court 3", label: "JTT 12U match", who: "League", tone: "yellow", w: "92%" },
                      { court: "Court 4", label: "Open", who: "", tone: "muted", w: "0%" },
                      { court: "Court 11a", label: "Pickleball clinic", who: "Pro shop", tone: "pink", w: "40%" },
                    ].map((r) => (
                      <div key={r.court} className="flex items-center gap-3">
                        <span className="text-[10px] text-white/40 w-14 shrink-0">{r.court}</span>
                        <div className="flex-1 h-7 rounded-md bg-white/[0.04] border border-white/[0.06] relative overflow-hidden">
                          {r.w !== "0%" && (
                            <div
                              className={`absolute inset-y-0 left-0 rounded-md flex items-center px-2.5 ${
                                r.tone === "lime" ? "bg-[#D3FB52]/20 border border-[#D3FB52]/30"
                                : r.tone === "yellow" ? "bg-amber-400/20 border border-amber-400/30"
                                : r.tone === "cyan" ? "bg-cyan-400/20 border border-cyan-400/30"
                                : "bg-pink-400/20 border border-pink-400/30"
                              }`}
                              style={{ width: r.w }}
                            >
                              <span className="text-[10px] text-white/80 font-medium truncate">{r.label}</span>
                            </div>
                          )}
                          {r.w === "0%" && (
                            <span className="absolute inset-0 flex items-center px-2.5 text-[10px] text-white/25">Open</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI command bar */}
                  <div className="mt-3 flex items-center gap-2 bg-white/[0.05] border border-white/10 rounded-lg px-3 py-2.5">
                    <Sparkles size={14} className="text-[#D3FB52] shrink-0" />
                    <span className="text-[11px] text-white/60 truncate">&ldquo;Book court 4 for a 5pm clinic and text the waitlist&rdquo;</span>
                  </div>
                </div>
              </div>

              {/* floating callout */}
              <div className="absolute -bottom-4 -left-4 bg-[#0a1822] border border-[#D3FB52]/25 rounded-xl px-3.5 py-2.5 shadow-xl hidden sm:flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-[#D3FB52]/15 flex items-center justify-center">
                  <BarChart3 size={14} className="text-[#D3FB52]" />
                </div>
                <div>
                  <p className="text-[9px] text-white/40 leading-none mb-0.5">Courts filled today</p>
                  <p className="text-sm font-bold text-white leading-none">+38%</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== CAPABILITY MARQUEE ===================== */}
      <section className="relative border-y border-white/[0.06] py-5 overflow-hidden bg-[#001016]">
        <div className="flex hm-marquee whitespace-nowrap">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex items-center shrink-0">
              {[
                "Live Court Sheets", "Team Leagues", "Junior Team Tennis", "Round Robins",
                "Tournaments", "Quads", "Strength Ladders", "Magic-Link Scoring",
                "Lesson Booking", "Racquet Stringing", "Player Matching", "UTR Lookup",
                "Swim Volunteer Points", "AI Coaching",
              ].map((cap) => (
                <span key={`${dup}-${cap}`} className="flex items-center gap-3 px-6 text-sm font-medium text-white/35 uppercase tracking-wider">
                  {cap}
                  <span className="w-1 h-1 rounded-full bg-[#D3FB52]/50" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ===================== LEAGUES & JTT SPOTLIGHT ===================== */}
      <section id="leagues" className="relative py-20 sm:py-28 px-5 sm:px-6 overflow-hidden bg-[#002838]">
        <div aria-hidden className="absolute top-1/3 -right-20 w-96 h-96 bg-[#D3FB52]/8 rounded-full blur-3xl pointer-events-none" />
        <div className="relative max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* copy */}
          <div>
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#D3FB52]/10 text-[#D3FB52] text-xs font-bold tracking-widest uppercase mb-5">
              <Sparkles size={13} /> New
            </span>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-5 leading-tight">
              The whole league season,<br /><span className="text-[#D3FB52]">run for you.</span>
            </h2>
            <p className="text-white/60 text-lg leading-relaxed mb-8">
              Built for Junior Team Tennis and adult team leagues alike. Coaches manage
              their own rosters with magic links, the computer keeps every team in
              strength order, and match day runs itself — across multiple sites, any
              court count, singles, doubles, or a mix.
            </p>
            <div className="space-y-3.5 mb-9">
              {[
                { icon: ListOrdered, text: "Strength-ordered rosters that auto-re-ladder as scores come in" },
                { icon: MapPin, text: "Two-site match days with live, real-time score entry" },
                { icon: ShieldCheck, text: "Magic-link access — coaches manage rosters with no logins or shared contacts" },
                { icon: Users, text: "Auto-assign players by strength, with tap-to-override on game day" },
              ].map((f) => {
                const Icon = f.icon;
                return (
                  <div key={f.text} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#D3FB52]/10 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon size={16} className="text-[#D3FB52]" />
                    </div>
                    <p className="text-white/75 text-[15px] leading-relaxed pt-1">{f.text}</p>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => goToTool("/mixer/leagues")}
              className="inline-flex items-center gap-2 px-7 py-3.5 bg-[#D3FB52] text-[#002838] rounded-xl font-semibold hover:bg-[#c5f035] hover:-translate-y-0.5 transition-all shadow-lg shadow-[#D3FB52]/20"
            >
              Build your league <ArrowRight size={17} />
            </button>
          </div>

          {/* match-day scorecard mockup */}
          <div className="relative">
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/40 bg-[#001016]">
              <div className="flex items-center justify-between px-5 py-3.5 bg-[#0a1822] border-b border-white/[0.06]">
                <div className="flex items-center gap-2">
                  <Trophy size={15} className="text-[#D3FB52]" />
                  <span className="text-sm font-semibold">Sleepy Hollow vs Meadow</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#D3FB52]/15 text-[#D3FB52]">12U</span>
              </div>
              <div className="p-4 space-y-2">
                {[
                  { court: "1", line: "Emmett d. Will", score: "8–2", done: true },
                  { court: "2", line: "Anand d. Luke", score: "8–4", done: true },
                  { court: "3", line: "Niam vs Ryan", score: "5–3", done: false },
                  { court: "4", line: "Dean/Lucas vs Bennett/Van", score: "7–6", done: true },
                ].map((m) => (
                  <div key={m.court} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[10px] text-white/40 w-12 shrink-0">Court {m.court}</span>
                      <span className="text-sm text-white/85 truncate">{m.line}</span>
                    </div>
                    <span className={`text-sm font-bold font-mono shrink-0 ml-2 ${m.done ? "text-[#D3FB52]" : "text-white/30"}`}>
                      {m.done ? m.score : "live"}
                    </span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 px-1">
                  <span className="text-xs text-white/40 flex items-center gap-1.5"><ListOrdered size={13} /> Ladder updating…</span>
                  <span className="text-xs font-semibold text-[#D3FB52]">SH leads 3–1</span>
                </div>
              </div>
            </div>
            <div className="absolute -top-4 -right-3 bg-[#0a1822] border border-white/10 rounded-xl px-3 py-2 shadow-xl hidden sm:flex items-center gap-2">
              <Star size={13} className="text-[#D3FB52]" />
              <span className="text-[11px] text-white/70 font-medium">5 clubs · Lamorinda</span>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== PRODUCT SHOWCASE ===================== */}
      <ProductShowcase />

      {/* ===================== TOOLS GRID ===================== */}
      <section id="tools" className="py-20 sm:py-28 px-5 sm:px-6 bg-[#001016]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14 max-w-2xl mx-auto">
            <h2 className="text-sm font-semibold text-[#D3FB52] uppercase tracking-widest mb-3">Your Toolkit</h2>
            <p className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">One platform. Every job at the club.</p>
            <p className="text-white/50 text-lg">Built for directors, coaches, and pro shops — activate only what you need.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {tools.map((tool) => {
              const Icon = tool.icon;
              const CardTag = tool.external ? 'a' : 'div';
              const cardProps = tool.external
                ? { href: tool.href, target: "_blank", rel: "noopener noreferrer" }
                : { onClick: tool.onClick };

              return (
                <CardTag
                  key={tool.name}
                  {...(cardProps as any)}
                  className="group relative bg-white/[0.03] border border-white/[0.07] rounded-2xl p-6 sm:p-7 cursor-pointer
                    hover:bg-white/[0.06] hover:border-white/[0.14] hover:shadow-2xl hover:shadow-black/30 hover:-translate-y-1
                    transition-all duration-300 overflow-hidden"
                >
                  <div aria-hidden className="absolute -right-10 -top-10 w-28 h-28 rounded-full bg-white/[0.02] group-hover:bg-white/[0.04] blur-2xl transition-colors" />
                  <div className="relative flex items-start justify-between mb-5">
                    <div className={`w-12 h-12 ${tool.bg} rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform`}>
                      <Icon className={tool.color} size={22} />
                    </div>
                    <div className="flex items-center gap-2">
                      {tool.badge && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#D3FB52] text-[#002838] tracking-wide">
                          {tool.badge}
                        </span>
                      )}
                      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${tool.tagColor}`}>
                        {tool.tag}
                      </span>
                    </div>
                  </div>
                  <h3 className="relative text-xl font-bold mb-2 tracking-tight">{tool.name}</h3>
                  <p className="relative text-white/50 text-sm leading-relaxed mb-5">{tool.description}</p>
                  <div className={`relative flex items-center gap-2 text-sm font-semibold ${tool.color} group-hover:gap-3 transition-all`}>
                    {tool.external ? (
                      <>Visit Site <ExternalLink size={14} /></>
                    ) : (
                      <>{user ? "Open Tool" : "Get Started"} <ArrowRight size={14} /></>
                    )}
                  </div>
                </CardTag>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===================== STATS BAND ===================== */}
      <section className="py-16 px-5 sm:px-6 bg-[#002838] border-y border-white/[0.06]">
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: "9", label: "Tools, one login" },
            { value: "4", label: "Event formats" },
            { value: "11", label: "Courts, live-tracked" },
            { value: "5", label: "Clubs in one league" },
          ].map((s) => (
            <div key={s.label}>
              <p className="text-4xl sm:text-5xl font-bold text-[#D3FB52] tracking-tight mb-1">{s.value}</p>
              <p className="text-white/50 text-sm">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ===================== HOW IT WORKS ===================== */}
      <section className="py-20 sm:py-28 px-5 sm:px-6 bg-[#001016]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-sm font-semibold text-[#D3FB52] uppercase tracking-widest mb-3">How It Works</h2>
            <p className="text-3xl sm:text-4xl font-bold tracking-tight">Up and running in minutes</p>
          </div>

          <div className="relative grid md:grid-cols-3 gap-10 md:gap-8">
            <div aria-hidden className="hidden md:block absolute top-8 left-[16%] right-[16%] h-px bg-gradient-to-r from-transparent via-[#D3FB52]/30 to-transparent" />
            {[
              { step: "1", title: "Create your account", description: "Sign up free and set up your club profile. No credit card required.", icon: User },
              { step: "2", title: "Activate your tools", description: "Turn on court sheets, leagues, lessons, stringing, player matching — or all of them.", icon: Zap },
              { step: "3", title: "Run your club", description: "Fill courts, run the season, engage players, and track everything in one place.", icon: BarChart3 },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="relative text-center">
                  <div className="relative inline-flex mb-6">
                    <div className="w-16 h-16 bg-[#001820] border border-[#D3FB52]/25 rounded-2xl flex items-center justify-center">
                      <Icon className="text-[#D3FB52]" size={24} />
                    </div>
                    <span className="absolute -top-2 -right-2 w-7 h-7 bg-[#D3FB52] text-[#002838] rounded-full flex items-center justify-center text-xs font-bold">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed max-w-xs mx-auto">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===================== PLAYER SECTION ===================== */}
      <section id="players" className="py-20 sm:py-28 px-5 sm:px-6 bg-[#002838]">
        <div className="max-w-4xl mx-auto">
          <div className="relative bg-white/[0.03] border border-white/[0.07] rounded-3xl p-8 md:p-12 overflow-hidden">
            <div aria-hidden className="absolute -top-16 -right-16 w-56 h-56 bg-[#D3FB52]/8 rounded-full blur-3xl" />
            <div className="relative text-center mb-10">
              <div className="w-16 h-16 bg-[#D3FB52]/10 border border-[#D3FB52]/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <UserCircle className="text-[#D3FB52]" size={28} />
              </div>
              <h3 className="text-2xl md:text-3xl font-bold mb-3 tracking-tight">Are you a player?</h3>
              <p className="text-white/50 max-w-lg mx-auto">
                Book lessons, check stringing orders, find matches, join leagues, and view events — all in one place.
              </p>
            </div>
            <div className="relative grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { href: "/client/dashboard", icon: Calendar, name: "My Lessons", sub: "Book & manage", color: "text-blue-400", bg: "bg-blue-400/10 hover:bg-blue-400/20" },
                { href: "/client/dashboard?tab=stringing", icon: Wrench, name: "My Stringing", sub: "Order status", color: "text-pink-400", bg: "bg-pink-400/10 hover:bg-pink-400/20" },
                { href: "/client/dashboard?tab=events", icon: Trophy, name: "Events", sub: "Mixers & leagues", color: "text-orange-400", bg: "bg-orange-400/10 hover:bg-orange-400/20" },
                { href: "/courtconnect/events", icon: Users, name: "Find Players", sub: "Match & play", color: "text-emerald-400", bg: "bg-emerald-400/10 hover:bg-emerald-400/20" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    className={`flex flex-col items-center gap-2.5 p-5 ${item.bg} rounded-xl transition-all duration-200`}
                  >
                    <Icon className={`h-7 w-7 ${item.color}`} />
                    <span className="font-semibold text-sm">{item.name}</span>
                    <span className={`text-xs ${item.color} opacity-70`}>{item.sub}</span>
                  </Link>
                );
              })}
            </div>
            <div className="relative text-center mt-8">
              <Link href="/find-coach" className="text-[#D3FB52] hover:underline font-medium text-sm inline-flex items-center gap-1">
                Looking for your coach? Find them here <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ===================== QUICK ACCESS (logged in) ===================== */}
      {user && (
        <section className="py-14 px-5 sm:px-6 bg-[#001016] border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-lg font-bold mb-5 text-center text-white/80">Quick Access</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { href: "/courtsheet/staff", icon: LayoutGrid, name: "CourtSheet", color: "bg-cyan-500 hover:bg-cyan-600" },
                { href: "/mixer/leagues", icon: Trophy, name: "Leagues & JTT", color: "bg-lime-500 hover:bg-lime-600" },
                { href: "/mixer/home", icon: Shuffle, name: "MixerMode", color: "bg-orange-500 hover:bg-orange-600" },
                { onClick: goToLessons, icon: Clock, name: "Lessons", color: "bg-blue-500 hover:bg-blue-600" },
                { href: "/stringing/jobs", icon: Wrench, name: "Stringing", color: "bg-pink-500 hover:bg-pink-600" },
                { href: "/courtconnect/home", icon: Users, name: "CourtConnect", color: "bg-emerald-500 hover:bg-emerald-600" },
                { href: "/courtconnect/vault", icon: Database, name: "PlayerVault", color: "bg-teal-500 hover:bg-teal-600" },
                { href: "/swim", icon: Waves, name: "SwimMode", color: "bg-sky-500 hover:bg-sky-600" },
                { href: "https://coachmode.ai", icon: GraduationCap, name: "CoachMode.ai", color: "bg-violet-500 hover:bg-violet-600", external: true },
              ].map((item) => {
                const Icon = item.icon;
                const isButton = 'onClick' in item && item.onClick;
                const isExternal = 'external' in item && item.external;

                if (isButton) {
                  return (
                    <button
                      key={item.name}
                      onClick={item.onClick}
                      className={`flex items-center justify-center gap-2.5 p-3.5 ${item.color} text-white rounded-xl font-semibold text-sm transition-colors`}
                    >
                      <Icon size={18} /> {item.name}
                    </button>
                  );
                }

                if (isExternal) {
                  return (
                    <a
                      key={item.name}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2.5 p-3.5 ${item.color} text-white rounded-xl font-semibold text-sm transition-colors`}
                    >
                      <Icon size={18} /> {item.name}
                    </a>
                  );
                }

                return (
                  <Link
                    key={item.name}
                    href={item.href!}
                    className={`flex items-center justify-center gap-2.5 p-3.5 ${item.color} text-white rounded-xl font-semibold text-sm transition-colors`}
                  >
                    <Icon size={18} /> {item.name}
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ===================== CTA ===================== */}
      <section className="relative py-24 sm:py-32 px-5 sm:px-6 overflow-hidden bg-[#002838]">
        <div aria-hidden className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] pointer-events-none">
          <div className="hm-spin-slow w-full h-full rounded-full opacity-20 [background:conic-gradient(from_0deg,transparent,#D3FB52,transparent_55%)] blur-3xl" />
        </div>
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="text-3xl sm:text-5xl font-bold mb-5 tracking-tight">
            Ready to run your club from <span className="hm-gradient-text">one screen?</span>
          </h2>
          <p className="text-white/55 text-lg mb-10 max-w-xl mx-auto">
            Set up in five minutes. Free forever for clubs — fill courts, run your season, and ditch the spreadsheets.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-9 py-4 bg-[#D3FB52] text-[#002838] rounded-xl font-semibold text-base hover:bg-[#c5f035] hover:-translate-y-0.5 transition-all shadow-xl shadow-[#D3FB52]/25"
          >
            Get Started Free <ArrowRight size={18} />
          </Link>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/40 mt-8">
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> Free forever for clubs</span>
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> Setup in 5 minutes</span>
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> Cancel anytime</span>
          </div>
        </div>
      </section>

      {/* ===================== FOOTER ===================== */}
      <footer className="border-t border-white/[0.06] bg-[#001016] py-14 px-5 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-10">
            <div className="col-span-2 md:col-span-2">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 bg-[#D3FB52] rounded-lg flex items-center justify-center">
                  <Zap className="text-[#002838]" size={16} />
                </div>
                <span className="font-bold">ClubMode<span className="text-[#D3FB52]"> AI</span></span>
              </div>
              <p className="text-white/40 text-sm leading-relaxed max-w-xs">
                The complete platform for racquet sports clubs, coaches, and directors — courts, leagues, lessons, and more in one login.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-3 text-white/70">Run the Club</h4>
              <ul className="space-y-2 text-sm text-white/40">
                <li><button onClick={() => goToTool("/courtsheet/staff")} className="hover:text-white transition-colors">CourtSheet AI</button></li>
                <li><Link href="/mixer/leagues" className="hover:text-white transition-colors">Leagues &amp; JTT</Link></li>
                <li><Link href="/mixer/home" className="hover:text-white transition-colors">MixerMode AI</Link></li>
                <li><Link href="/lessons/dashboard" className="hover:text-white transition-colors">LastMinuteLesson</Link></li>
                <li><Link href="/stringing/jobs" className="hover:text-white transition-colors">StringingMode AI</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-3 text-white/70">Players &amp; More</h4>
              <ul className="space-y-2 text-sm text-white/40">
                <li><Link href="/courtconnect/home" className="hover:text-white transition-colors">CourtConnect</Link></li>
                <li><Link href="/courtconnect/vault" className="hover:text-white transition-colors">PlayerVault</Link></li>
                <li><Link href="/swim" className="hover:text-white transition-colors">SwimMode</Link></li>
                <li><Link href="/find-coach" className="hover:text-white transition-colors">Find a Coach</Link></li>
                <li><a href="https://coachmode.ai" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">CoachMode.ai</a></li>
              </ul>
            </div>
            <div className="md:hidden col-span-2">
              <h4 className="font-semibold text-sm mb-3 text-white/70">Get Started</h4>
              <ul className="space-y-2 text-sm text-white/40">
                <li><Link href="/login" className="hover:text-white transition-colors">Sign In</Link></li>
                <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/30">
            <span>&copy; {new Date().getFullYear()} ClubMode AI. All rights reserved.</span>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="hover:text-white/60 transition-colors">Pricing</Link>
              <Link href="/login" className="hover:text-white/60 transition-colors">Sign In</Link>
              <span className="flex items-center gap-1">
                Powered by
                <a href="https://coachmode.ai" target="_blank" rel="noopener noreferrer" className="text-[#D3FB52] hover:underline ml-1">CoachMode.ai</a>
              </span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center lg:text-left">
      <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight">{value}</p>
      <p className="text-xs text-white/45 uppercase tracking-wider mt-0.5">{label}</p>
    </div>
  );
}

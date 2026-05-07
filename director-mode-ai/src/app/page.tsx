'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Shuffle, Clock, Wrench, ArrowRight, LogOut, User, Calendar,
  UserCircle, Trophy, Users, GraduationCap, Database, ExternalLink,
  Sparkles, Check, ChevronRight, Zap, Shield, BarChart3, Waves
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import ProductShowcase from "@/components/shared/ProductShowcase";

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      setLoading(false);
    });
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
      name: "MixerMode AI",
      tag: "EVENTS",
      description: "Run round robins, generate balanced teams, and track live scores across formats.",
      icon: Shuffle,
      color: "text-orange-400",
      bg: "bg-orange-400/10",
      border: "border-orange-400/20",
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
      border: "border-blue-400/20",
      tagColor: "bg-blue-400/10 text-blue-400",
      onClick: goToLessons,
    },
    {
      name: "StringingMode AI",
      tag: "PRO SHOP",
      description: "AI string recommendations, job tracking, customer management, and inventory.",
      icon: Wrench,
      color: "text-pink-400",
      bg: "bg-pink-400/10",
      border: "border-pink-400/20",
      tagColor: "bg-pink-400/10 text-pink-400",
      onClick: () => goToTool("/stringing/jobs"),
    },
    {
      name: "CourtConnect",
      tag: "PLAYERS",
      description: "Match with players by skill level, create events, and manage RSVPs with waitlists.",
      icon: Users,
      color: "text-emerald-400",
      bg: "bg-emerald-400/10",
      border: "border-emerald-400/20",
      tagColor: "bg-emerald-400/10 text-emerald-400",
      onClick: () => goToTool("/courtconnect/home"),
    },
    {
      name: "PlayerVault",
      tag: "ROSTER",
      description: "Club roster CRM with NTRP/UTR ratings, UTR lookup, and bulk CourtConnect import.",
      icon: Database,
      color: "text-teal-400",
      bg: "bg-teal-400/10",
      border: "border-teal-400/20",
      tagColor: "bg-teal-400/10 text-teal-400",
      onClick: () => goToTool("/courtconnect/vault"),
    },
    {
      name: "CoachMode.ai",
      tag: "COACHING AI",
      description: "AI-powered video analysis, drill planning, and player development tools.",
      icon: GraduationCap,
      color: "text-violet-400",
      bg: "bg-violet-400/10",
      border: "border-violet-400/20",
      tagColor: "bg-violet-400/10 text-violet-400",
      href: "https://coachmode.ai",
      external: true,
    },
    {
      name: "SwimMode",
      tag: "SWIM TEAM",
      description: "Volunteer points tracker for swim team leads. Define jobs, track family points across the season, CSV import + export.",
      icon: Waves,
      color: "text-cyan-400",
      bg: "bg-cyan-400/10",
      border: "border-cyan-400/20",
      tagColor: "bg-cyan-400/10 text-cyan-400",
      onClick: () => goToTool("/swim"),
    },
  ];

  return (
    <div className="min-h-screen bg-[#002838] text-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Header */}
      <header className="border-b border-white/10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#D3FB52] rounded-xl flex items-center justify-center">
              <Zap className="text-[#002838]" size={20} />
            </div>
            <span className="font-bold text-xl tracking-tight">ClubMode AI</span>
          </div>
          <div className="flex items-center gap-3">
            {loading ? (
              <div className="w-24 h-8 bg-white/10 animate-pulse rounded-lg" />
            ) : user ? (
              <>
                <Link href="/client/dashboard" className="flex items-center gap-2 px-4 py-2 text-[#D3FB52] hover:bg-white/5 rounded-lg font-medium text-sm transition-colors">
                  <Calendar size={16} />
                  My Account
                </Link>
                <div className="flex items-center gap-2 text-white/60 px-3 py-2 text-sm">
                  <User size={16} />
                  <span>{user.email?.split("@")[0]}</span>
                </div>
                <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 text-white/60 hover:text-white hover:bg-white/5 rounded-lg transition-colors">
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <>
                <Link href="/client/dashboard" className="text-white/70 hover:text-white font-medium text-sm transition-colors">
                  I&apos;m a Player
                </Link>
                <Link href="/login" className="text-white/70 hover:text-white text-sm transition-colors">
                  Sign In
                </Link>
                <Link href="/login" className="px-5 py-2.5 bg-[#D3FB52] text-[#002838] rounded-lg font-semibold text-sm hover:bg-[#c5f035] transition-colors">
                  Get Started Free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative py-24 md:py-32 px-6 overflow-hidden">
        {/* Background gradient blurs */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#D3FB52]/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-blue-500/5 rounded-full blur-3xl" />

        <div className="max-w-4xl mx-auto text-center relative z-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-[#D3FB52]/10 border border-[#D3FB52]/20 rounded-full text-sm font-medium text-[#D3FB52] mb-8">
            <Sparkles size={16} />
            The Complete Racquet Sports Platform
          </div>

          <h1 className="text-5xl md:text-7xl font-bold mb-6 tracking-tight leading-[1.1]">
            Six Powerful Tools.
            <br />
            <span className="text-[#D3FB52]">One Platform.</span>
          </h1>

          <p className="text-lg md:text-xl text-white/60 mb-10 max-w-2xl mx-auto leading-relaxed">
            Everything your club needs to run events, manage lessons, match players, track rosters, and operate your pro shop — all in one place.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link
              href="/login"
              className="px-8 py-3.5 bg-[#D3FB52] text-[#002838] rounded-xl font-semibold text-base hover:bg-[#c5f035] transition-all shadow-lg shadow-[#D3FB52]/20 hover:shadow-[#D3FB52]/30"
            >
              Get Started Free
            </Link>
            <a
              href="https://coachmode.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="px-8 py-3.5 border border-white/20 text-white rounded-xl font-semibold text-base hover:bg-white/5 transition-all flex items-center gap-2"
            >
              Visit CoachMode.ai <ExternalLink size={16} />
            </a>
          </div>

          <div className="flex items-center justify-center gap-6 text-sm text-white/50">
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> Free for clubs</span>
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> No credit card</span>
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> All racquet sports</span>
          </div>
        </div>
      </section>

      {/* Product Showcase */}
      <ProductShowcase />

      {/* Tools Grid */}
      <section className="py-20 px-6 bg-[#001820]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-sm font-semibold text-[#D3FB52] uppercase tracking-widest mb-3">Your Toolkit</h2>
            <p className="text-3xl md:text-4xl font-bold tracking-tight">Built for Coaches, Directors & Pro Shops</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
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
                  className={`group bg-white/[0.03] border border-white/[0.06] rounded-2xl p-7 cursor-pointer
                    hover:bg-white/[0.06] hover:border-white/[0.12] hover:shadow-2xl hover:-translate-y-1
                    transition-all duration-300`}
                >
                  <div className="flex items-start justify-between mb-5">
                    <div className={`w-12 h-12 ${tool.bg} rounded-xl flex items-center justify-center`}>
                      <Icon className={tool.color} size={22} />
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${tool.tagColor}`}>
                      {tool.tag}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold mb-2 tracking-tight">{tool.name}</h3>
                  <p className="text-white/50 text-sm leading-relaxed mb-5">{tool.description}</p>
                  <div className={`flex items-center gap-2 text-sm font-semibold ${tool.color} group-hover:gap-3 transition-all`}>
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

      {/* How It Works */}
      <section className="py-20 px-6 bg-[#002838]">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-sm font-semibold text-[#D3FB52] uppercase tracking-widest mb-3">How It Works</h2>
            <p className="text-3xl md:text-4xl font-bold tracking-tight">Up and running in minutes</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                step: "1",
                title: "Create Your Account",
                description: "Sign up free and set up your club profile. No credit card required.",
                icon: User,
              },
              {
                step: "2",
                title: "Choose Your Tools",
                description: "Activate the tools you need — events, lessons, stringing, player matching, or all of them.",
                icon: Zap,
              },
              {
                step: "3",
                title: "Grow Your Club",
                description: "Engage players, fill courts, streamline operations, and track everything in one place.",
                icon: BarChart3,
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.step} className="text-center">
                  <div className="relative inline-flex mb-6">
                    <div className="w-16 h-16 bg-[#D3FB52]/10 border border-[#D3FB52]/20 rounded-2xl flex items-center justify-center">
                      <Icon className="text-[#D3FB52]" size={24} />
                    </div>
                    <span className="absolute -top-2 -right-2 w-7 h-7 bg-[#D3FB52] text-[#002838] rounded-full flex items-center justify-center text-xs font-bold">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-2">{item.title}</h3>
                  <p className="text-white/50 text-sm leading-relaxed">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Player Section */}
      <section className="py-20 px-6 bg-[#001820]">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-2xl p-8 md:p-12">
            <div className="text-center mb-10">
              <div className="w-16 h-16 bg-[#D3FB52]/10 border border-[#D3FB52]/20 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <UserCircle className="text-[#D3FB52]" size={28} />
              </div>
              <h3 className="text-2xl md:text-3xl font-bold mb-3 tracking-tight">Are You a Player?</h3>
              <p className="text-white/50 max-w-lg mx-auto">
                Book lessons, check stringing orders, find matches, and view events — all in one place.
              </p>
            </div>
            <div className="grid md:grid-cols-4 gap-4">
              {[
                { href: "/client/dashboard", icon: Calendar, name: "My Lessons", sub: "Book & manage", color: "text-blue-400", bg: "bg-blue-400/10 hover:bg-blue-400/20" },
                { href: "/client/dashboard?tab=stringing", icon: Wrench, name: "My Stringing", sub: "Order status", color: "text-pink-400", bg: "bg-pink-400/10 hover:bg-pink-400/20" },
                { href: "/client/dashboard?tab=events", icon: Trophy, name: "Events", sub: "Mixers & tournaments", color: "text-orange-400", bg: "bg-orange-400/10 hover:bg-orange-400/20" },
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
            <div className="text-center mt-8">
              <Link href="/find-coach" className="text-[#D3FB52] hover:underline font-medium text-sm inline-flex items-center gap-1">
                Looking for your coach? Find them here <ChevronRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Access (logged in) */}
      {user && (
        <section className="py-14 px-6 bg-[#002838] border-t border-white/[0.06]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-lg font-bold mb-5 text-center text-white/80">Quick Access</h2>
            <div className="grid md:grid-cols-3 gap-3">
              {[
                { href: "/mixer/home", icon: Shuffle, name: "MixerMode", color: "bg-orange-500 hover:bg-orange-600" },
                { onClick: goToLessons, icon: Clock, name: "Lessons", color: "bg-blue-500 hover:bg-blue-600" },
                { href: "/stringing/jobs", icon: Wrench, name: "Stringing", color: "bg-pink-500 hover:bg-pink-600" },
                { href: "/courtconnect/home", icon: Users, name: "CourtConnect", color: "bg-emerald-500 hover:bg-emerald-600" },
                { href: "/courtconnect/vault", icon: Database, name: "PlayerVault", color: "bg-teal-500 hover:bg-teal-600" },
                { href: "https://coachmode.ai", icon: GraduationCap, name: "CoachMode.ai", color: "bg-violet-500 hover:bg-violet-600", external: true },
                { href: "/swim", icon: Waves, name: "SwimMode", color: "bg-cyan-500 hover:bg-cyan-600" },
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

      {/* CTA */}
      <section className="relative py-24 px-6 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#D3FB52]/5 rounded-full blur-3xl" />

        <div className="max-w-3xl mx-auto text-center relative z-10">
          <h2 className="text-3xl md:text-5xl font-bold mb-5 tracking-tight">
            Ready to power up your club?
          </h2>
          <p className="text-white/50 text-lg mb-10 max-w-xl mx-auto">
            Join clubs already using ClubMode AI to fill courts, engage players, and streamline operations.
          </p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 px-8 py-4 bg-[#D3FB52] text-[#002838] rounded-xl font-semibold text-base hover:bg-[#c5f035] transition-all shadow-lg shadow-[#D3FB52]/20"
          >
            Get Started Free <ArrowRight size={18} />
          </Link>
          <div className="flex items-center justify-center gap-6 text-sm text-white/40 mt-8">
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> Free forever for clubs</span>
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> Setup in 5 minutes</span>
            <span className="flex items-center gap-2"><Check size={16} className="text-[#D3FB52]" /> Cancel anytime</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] bg-[#001820] py-12 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 bg-[#D3FB52] rounded-lg flex items-center justify-center">
                  <Zap className="text-[#002838]" size={16} />
                </div>
                <span className="font-bold">ClubMode AI</span>
              </div>
              <p className="text-white/40 text-sm leading-relaxed">
                The complete platform for racquet sports clubs, coaches, and directors.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-3 text-white/70">Tools</h4>
              <ul className="space-y-2 text-sm text-white/40">
                <li><Link href="/mixer/home" className="hover:text-white transition-colors">MixerMode AI</Link></li>
                <li><Link href="/lessons/dashboard" className="hover:text-white transition-colors">LastMinuteLesson</Link></li>
                <li><Link href="/stringing/jobs" className="hover:text-white transition-colors">StringingMode AI</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-3 text-white/70">More Tools</h4>
              <ul className="space-y-2 text-sm text-white/40">
                <li><Link href="/courtconnect/home" className="hover:text-white transition-colors">CourtConnect</Link></li>
                <li><Link href="/courtconnect/vault" className="hover:text-white transition-colors">PlayerVault</Link></li>
                <li><Link href="/swim" className="hover:text-white transition-colors">SwimMode</Link></li>
                <li><a href="https://coachmode.ai" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">CoachMode.ai</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-sm mb-3 text-white/70">Get Started</h4>
              <ul className="space-y-2 text-sm text-white/40">
                <li><Link href="/login" className="hover:text-white transition-colors">Sign In</Link></li>
                <li><Link href="/login" className="hover:text-white transition-colors">Create Account</Link></li>
                <li><Link href="/find-coach" className="hover:text-white transition-colors">Find a Coach</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/[0.06] pt-6 flex items-center justify-between text-xs text-white/30">
            <span>&copy; {new Date().getFullYear()} ClubMode AI. All rights reserved.</span>
            <div className="flex items-center gap-1">
              Powered by{" "}
              <a href="https://coachmode.ai" target="_blank" rel="noopener noreferrer" className="text-[#D3FB52] hover:underline ml-1">
                CoachMode.ai
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

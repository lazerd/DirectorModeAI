'use client';

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shuffle, Clock, Wrench, ArrowRight, LogOut, User, Calendar, UserCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <header className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <Shuffle className="text-white" size={20} />
            </div>
            <span className="font-bold text-xl">Director Mode AI</span>
          </div>
          <div className="flex items-center gap-4">
            {loading ? (
              <div className="w-24 h-8 bg-gray-200 animate-pulse rounded"></div>
            ) : user ? (
              <>
                <Link href="/client/dashboard" className="flex items-center gap-2 px-3 py-2 text-green-600 hover:bg-green-50 rounded-lg font-medium">
                  <Calendar size={18} />
                  My Account
                </Link>
                <div className="flex items-center gap-2 text-gray-600 px-3 py-2">
                  <User size={18} />
                  <span>{user.email?.split("@")[0]}</span>
                </div>
                <button onClick={handleLogout} className="flex items-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
                  <LogOut size={18} />
                </button>
              </>
            ) : (
              <>
                <Link href="/client/dashboard" className="text-green-600 hover:text-green-700 font-medium">I'm a Player</Link>
                <Link href="/login" className="text-gray-600 hover:text-gray-900">Sign In</Link>
                <Link href="/login" className="px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-full text-sm font-medium mb-6">
            <Shuffle size={16} />
            The Complete Tennis and Racket Sports Platform
          </div>
          <h1 className="text-5xl md:text-6xl font-bold mb-6">
            Three Powerful Tools.<br />
            <span className="text-blue-600">One Platform.</span>
          </h1>
          <p className="text-xl text-gray-600 mb-8">
            Everything you need to run events, manage lessons, and operate your pro shop.
          </p>
        </div>
      </section>

      {/* Admin/Coach Tools */}
      <section className="py-16 px-4">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-center text-sm font-semibold text-gray-500 uppercase tracking-wide mb-8">For Coaches, Directors & Pro Shops</h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div onClick={() => goToTool("/mixer/home")} className="bg-white rounded-2xl border-2 p-8 hover:shadow-xl cursor-pointer group">
              <div className="w-16 h-16 bg-orange-100 rounded-2xl flex items-center justify-center mb-6">
                <Shuffle className="text-orange-600" size={28} />
              </div>
              <span className="inline-block px-3 py-1 bg-orange-100 text-orange-600 rounded-full text-xs font-semibold mb-4">EVENTS</span>
              <h3 className="text-2xl font-bold mb-3">MixerMode AI</h3>
              <p className="text-gray-600 mb-6">Run round robins, generate balanced teams, track scores.</p>
              <div className="flex items-center gap-2 text-orange-600 font-semibold">
                {user ? "Open Tool" : "Sign in"} <ArrowRight size={18} />
              </div>
            </div>

            <div onClick={goToLessons} className="bg-white rounded-2xl border-2 p-8 hover:shadow-xl cursor-pointer group">
              <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mb-6">
                <Clock className="text-blue-600" size={28} />
              </div>
              <span className="inline-block px-3 py-1 bg-blue-100 text-blue-600 rounded-full text-xs font-semibold mb-4">LESSONS</span>
              <h3 className="text-2xl font-bold mb-3">LastMinuteLesson</h3>
              <p className="text-gray-600 mb-6">Post open slots, notify clients, let them book.</p>
              <div className="flex items-center gap-2 text-blue-600 font-semibold">
                {user ? "Open Tool" : "Sign in"} <ArrowRight size={18} />
              </div>
            </div>

            <div onClick={() => goToTool("/stringing/jobs")} className="bg-white rounded-2xl border-2 p-8 hover:shadow-xl cursor-pointer group">
              <div className="w-16 h-16 bg-pink-100 rounded-2xl flex items-center justify-center mb-6">
                <Wrench className="text-pink-600" size={28} />
              </div>
              <span className="inline-block px-3 py-1 bg-pink-100 text-pink-600 rounded-full text-xs font-semibold mb-4">PRO SHOP</span>
              <h3 className="text-2xl font-bold mb-3">StringingMode AI</h3>
              <p className="text-gray-600 mb-6">String recommendations, job tracking, inventory.</p>
              <div className="flex items-center gap-2 text-pink-600 font-semibold">
                {user ? "Open Tool" : "Sign in"} <ArrowRight size={18} />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Player/Client Section */}
      <section className="py-16 px-4 bg-gradient-to-r from-green-50 to-blue-50">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl border-2 border-green-200 p-8 md:p-12">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="w-20 h-20 bg-green-100 rounded-2xl flex items-center justify-center flex-shrink-0">
                <UserCircle className="text-green-600" size={40} />
              </div>
              <div className="flex-1 text-center md:text-left">
                <h3 className="text-2xl font-bold mb-2">Are You a Player?</h3>
                <p className="text-gray-600 mb-4">
                  Looking to book lessons with your coach? Check your stringing order status? View your mixer history?
                </p>
                <div className="flex flex-wrap gap-3 justify-center md:justify-start">
                  <Link href="/client/dashboard" className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 flex items-center gap-2">
                    <Calendar size={18} />
                    My Lessons
                  </Link>
                  <Link href="/find-coach" className="px-6 py-3 border-2 border-green-600 text-green-600 rounded-lg font-semibold hover:bg-green-50 flex items-center gap-2">
                    Find My Coach
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {user && (
        <section className="py-12 px-4 bg-gray-50">
          <div className="max-w-6xl mx-auto">
            <h2 className="text-2xl font-bold mb-6 text-center">Quick Access</h2>
            <div className="grid md:grid-cols-3 gap-4">
              <Link href="/mixer/home" className="flex items-center justify-center gap-3 p-4 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600">
                <Shuffle size={20} /> MixerMode
              </Link>
              <button onClick={goToLessons} className="flex items-center justify-center gap-3 p-4 bg-blue-500 text-white rounded-xl font-semibold hover:bg-blue-600">
                <Clock size={20} /> Lessons
              </button>
              <Link href="/stringing/jobs" className="flex items-center justify-center gap-3 p-4 bg-pink-500 text-white rounded-xl font-semibold hover:bg-pink-600">
                <Wrench size={20} /> Stringing
              </Link>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, User, LogOut, X, Plus, Home, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format, parseISO, isPast } from 'date-fns';
import Link from 'next/link';

type Lesson = {
  id: string;
  start_time: string;
  end_time: string;
  location: string | null;
  coach_name: string;
  coach_slug: string;
};

type Coach = {
  slug: string;
  display_name: string;
};

export default function ClientDashboardPage() {
  const [upcomingLessons, setUpcomingLessons] = useState<Lesson[]>([]);
  const [pastLessons, setPastLessons] = useState<Lesson[]>([]);
  const [myCoaches, setMyCoaches] = useState<Coach[]>([]);
  const [clientName, setClientName] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      window.location.href = '/login?redirect=/client/dashboard';
      return;
    }

    const { data: client } = await supabase
      .from('lesson_clients')
      .select('id, name')
      .eq('profile_id', user.id)
      .single();

    if (!client) {
      setLoading(false);
      return;
    }

    setClientName(client.name || user.email || 'Client');

    // Get my approved coaches
    const { data: coachRelations } = await supabase
      .from('lesson_client_coaches')
      .select('lesson_coaches(slug, display_name)')
      .eq('client_id', client.id)
      .eq('status', 'approved');

    if (coachRelations) {
      setMyCoaches(coachRelations.map((r: any) => ({
        slug: r.lesson_coaches?.slug,
        display_name: r.lesson_coaches?.display_name
      })).filter((c: Coach) => c.slug));
    }

    // Get booked lessons
    const { data: slots } = await supabase
      .from('lesson_slots')
      .select('id, start_time, end_time, location, lesson_coaches(display_name, slug)')
      .eq('booked_by_client_id', client.id)
      .eq('status', 'booked')
      .order('start_time', { ascending: true });

    if (slots) {
      const lessons: Lesson[] = slots.map((slot: any) => ({
        id: slot.id,
        start_time: slot.start_time,
        end_time: slot.end_time,
        location: slot.location,
        coach_name: slot.lesson_coaches?.display_name || 'Coach',
        coach_slug: slot.lesson_coaches?.slug || ''
      }));

      setUpcomingLessons(lessons.filter(l => !isPast(parseISO(l.end_time))));
      setPastLessons(lessons.filter(l => isPast(parseISO(l.end_time))));
    }

    setLoading(false);
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  const cancelBooking = async (lessonId: string) => {
    if (!confirm('Are you sure you want to cancel this lesson?')) return;
    
    setCancelling(lessonId);
    const supabase = createClient();
    
    const { error } = await supabase
      .from('lesson_slots')
      .update({
        status: 'open',
        booked_by_client_id: null,
        booked_at: null
      })
      .eq('id', lessonId);

    if (error) {
      alert('Failed to cancel booking. Please try again.');
    } else {
      setUpcomingLessons(prev => prev.filter(l => l.id !== lessonId));
    }
    
    setCancelling(null);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation Header */}
      <nav className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-6">
              <Link href="/client/dashboard" className="font-bold text-lg text-blue-600">LastMinute</Link>
              <div className="flex items-center gap-1">
                <Link href="/client/dashboard" className="px-3 py-2 text-sm font-medium text-gray-900 bg-gray-100 rounded-lg">
                  My Lessons
                </Link>
                <Link href="/find-coach" className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1">
                  <Search className="h-4 w-4" />
                  Find Coach
                </Link>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600">{clientName}</span>
              <button onClick={handleSignOut} className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1">
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* My Coaches - Quick Book */}
        {myCoaches.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-medium text-gray-500 mb-2">Book with your coaches</h2>
            <div className="flex flex-wrap gap-2">
              {myCoaches.map((coach) => (
                <Link
                  key={coach.slug}
                  href={`/coach/${coach.slug}`}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm"
                >
                  <Plus className="h-4 w-4" />
                  Book with {coach.display_name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Upcoming Lessons */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Upcoming Lessons ({upcomingLessons.length})</h2>
          </div>

          {upcomingLessons.length === 0 ? (
            <div className="bg-white rounded-xl border p-8 text-center">
              <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">No upcoming lessons</p>
              <Link href="/find-coach" className="text-blue-600 hover:underline">Find a coach to book lessons</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {upcomingLessons.map((lesson) => (
                <div key={lesson.id} className="bg-white rounded-xl border p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <User className="h-6 w-6 text-blue-600" />
                      </div>
                      <div>
                        <Link href={`/coach/${lesson.coach_slug}`} className="font-semibold hover:text-blue-600">
                          {lesson.coach_name}
                        </Link>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
                          <div className="flex items-center gap-1">
                            <Calendar className="h-4 w-4" />
                            {format(parseISO(lesson.start_time), 'EEE, MMM d')}
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="h-4 w-4" />
                            {format(parseISO(lesson.start_time), 'h:mm a')}
                          </div>
                        </div>
                        {lesson.location && (
                          <div className="flex items-center gap-1 mt-1 text-sm text-gray-500">
                            <MapPin className="h-4 w-4" />
                            {lesson.location}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => cancelBooking(lesson.id)}
                      disabled={cancelling === lesson.id}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50"
                      title="Cancel booking"
                    >
                      {cancelling === lesson.id ? (
                        <div className="animate-spin h-4 w-4 border-2 border-red-500 border-t-transparent rounded-full" />
                      ) : (
                        <X className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Past Lessons */}
        {pastLessons.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4 text-gray-500">Past Lessons ({pastLessons.length})</h2>
            <div className="space-y-3 opacity-60">
              {pastLessons.map((lesson) => (
                <div key={lesson.id} className="bg-white rounded-xl border p-4">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                      <User className="h-6 w-6 text-gray-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-600">{lesson.coach_name}</h3>
                      <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          {format(parseISO(lesson.start_time), 'EEE, MMM d')}
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {format(parseISO(lesson.start_time), 'h:mm a')}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, User, LogOut, X, Plus, Search, Wrench, Trophy, ExternalLink } from 'lucide-react';
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

type StringingJob = {
  id: string;
  created_at: string;
  racket_brand: string | null;
  racket_model: string | null;
  string_brand: string | null;
  string_model: string | null;
  tension: string | null;
  status: string;
};

type MixerEvent = {
  id: string;
  name: string;
  date: string;
  location: string | null;
  status: string;
};

type Tab = 'lessons' | 'stringing' | 'events';

export default function ClientDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('lessons');

useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'stringing' || tab === 'events') {
    setActiveTab(tab);
  }
}, []);
  const [upcomingLessons, setUpcomingLessons] = useState<Lesson[]>([]);
  const [pastLessons, setPastLessons] = useState<Lesson[]>([]);
  const [myCoaches, setMyCoaches] = useState<Coach[]>([]);
  const [stringingJobs, setStringingJobs] = useState<StringingJob[]>([]);
  const [mixerEvents, setMixerEvents] = useState<MixerEvent[]>([]);
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
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

    setClientEmail(user.email || '');

    const { data: client } = await supabase
      .from('lesson_clients')
      .select('id, name')
      .eq('profile_id', user.id)
      .single();

    if (client) {
      setClientName(client.name || user.email || 'Client');
    } else {
      setClientName(user.email?.split('@')[0] || 'Client');
    }

    // Get my approved coaches
    if (client) {
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
    }

    // Get stringing jobs by email
    if (user.email) {
      const { data: jobs } = await supabase
        .from('stringing_customers')
        .select('id, created_at, racket_brand, racket_model, string_brand, string_model, tension, status')
        .eq('email', user.email)
        .order('created_at', { ascending: false });

      if (jobs) {
        setStringingJobs(jobs);
      }
    }

    // Get active mixer events
    const { data: events } = await supabase
      .from('mixer_events')
      .select('id, name, date, location, status')
      .in('status', ['upcoming', 'in_progress', 'active'])
      .order('date', { ascending: true });

    if (events) {
      setMixerEvents(events);
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
              <Link href="/" className="font-bold text-lg text-blue-600">DirectorMode</Link>
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

      {/* Tabs */}
      <div className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('lessons')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'lessons' 
                  ? 'border-blue-600 text-blue-600' 
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Calendar className="h-4 w-4" />
              My Lessons
            </button>
            <button
              onClick={() => setActiveTab('stringing')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'stringing' 
                  ? 'border-pink-600 text-pink-600' 
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Wrench className="h-4 w-4" />
              My Stringing
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'events' 
                  ? 'border-orange-600 text-orange-600' 
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <Trophy className="h-4 w-4" />
              Events
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* LESSONS TAB */}
        {activeTab === 'lessons' && (
          <>
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
                <Link href="/find-coach" className="text-blue-600 hover:underline text-sm flex items-center gap-1">
                  <Search className="h-4 w-4" />
                  Find a Coach
                </Link>
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
          </>
        )}

        {/* STRINGING TAB */}
        {activeTab === 'stringing' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">My Stringing History</h2>
            
            {stringingJobs.length === 0 ? (
              <div className="bg-white rounded-xl border p-8 text-center">
                <Wrench className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500 mb-2">No stringing jobs found</p>
                <p className="text-sm text-gray-400">Jobs will appear here when your pro shop strings your racket using {clientEmail}</p>
              </div>
            ) : (
              <div className="space-y-3">
                {stringingJobs.map((job) => (
                  <div key={job.id} className="bg-white rounded-xl border p-4">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-pink-100 rounded-full flex items-center justify-center">
                        <Wrench className="h-6 w-6 text-pink-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">
                              {job.racket_brand} {job.racket_model || 'Racket'}
                            </h3>
                            <p className="text-sm text-gray-600 mt-1">
                              {job.string_brand} {job.string_model} @ {job.tension}
                            </p>
                          </div>
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            job.status === 'completed' || job.status === 'picked_up'
                              ? 'bg-green-100 text-green-700'
                              : job.status === 'in_progress'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-gray-100 text-gray-700'
                          }`}>
                            {job.status?.replace('_', ' ') || 'pending'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          {format(parseISO(job.created_at), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* EVENTS TAB */}
        {activeTab === 'events' && (
          <div>
            <h2 className="text-lg font-semibold mb-4">Current Events</h2>
            
            {mixerEvents.length === 0 ? (
              <div className="bg-white rounded-xl border p-8 text-center">
                <Trophy className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <p className="text-gray-500">No active events right now</p>
              </div>
            ) : (
              <div className="space-y-3">
                {mixerEvents.map((event) => (
                  <Link 
                    key={event.id} 
                    href={`/mixer/events/${event.id}`}
                    className="block bg-white rounded-xl border p-4 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                        <Trophy className="h-6 w-6 text-orange-600" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{event.name}</h3>
                            {event.location && (
                              <p className="text-sm text-gray-600 mt-1">{event.location}</p>
                            )}
                          </div>
                          <ExternalLink className="h-4 w-4 text-gray-400" />
                        </div>
                        <p className="text-xs text-gray-400 mt-2">
                          {format(parseISO(event.date), 'EEE, MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

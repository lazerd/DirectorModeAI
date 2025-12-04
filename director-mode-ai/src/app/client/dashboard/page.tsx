'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Clock, User, X, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format, parseISO, isPast } from 'date-fns';

export default function ClientDashboardPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientName, setClientName] = useState('');

  useEffect(() => {
    loadBookings();
  }, []);

  const loadBookings = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { data: client } = await supabase.from('lesson_clients').select('id, name').eq('profile_id', user.id).single();
    if (!client) { setLoading(false); return; }

    setClientName(client.name || user.email || 'Client');

    const { data: slots } = await supabase.from('lesson_slots').select('id, start_time, end_time, location, status, lesson_coaches(display_name, slug)').eq('booked_by_client_id', client.id).eq('status', 'booked').order('start_time');

    if (slots) {
      setBookings(slots.map((s: any) => ({ ...s, coach_name: s.lesson_coaches?.display_name || 'Coach' })));
    }
    setLoading(false);
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  };

  const upcoming = bookings.filter(b => !isPast(parseISO(b.start_time)));

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">My Lessons</h1>
            <p className="text-gray-500">Welcome, {clientName}</p>
          </div>
          <button onClick={handleSignOut} className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"><LogOut className="h-4 w-4" /> Sign Out</button>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Upcoming Lessons ({upcoming.length})</h2>
          <a href="/find-coach" className="text-blue-600 hover:underline text-sm">+ Find a Coach</a>
        </div>
        {upcoming.length === 0 ? (
          <div className="bg-white rounded-xl border p-8 text-center">
            <Calendar className="h-12 w-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-600 mb-4">No upcoming lessons</p>
            <a href="/find-coach" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 inline-block">Find a Coach</a>
          </div>
        ) : (
          <div className="space-y-4">
            {upcoming.map((b) => (
              <div key={b.id} className="bg-white rounded-xl border p-4 flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center"><User className="h-6 w-6 text-blue-600" /></div>
                <div>
                  <p className="font-semibold">{b.coach_name}</p>
                  <p className="text-sm text-gray-600"><Calendar className="h-4 w-4 inline mr-1" />{format(parseISO(b.start_time), 'EEE, MMM d')} <Clock className="h-4 w-4 inline ml-2 mr-1" />{format(parseISO(b.start_time), 'h:mm a')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, ChevronLeft, ChevronRight, User, CheckCircle, Loader2, Send, LogOut, LogIn } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay, parseISO } from 'date-fns';

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  location: string | null;
  status: string;
};

type Coach = {
  id: string;
  display_name: string | null;
  slug: string;
  profile_id: string;
  email: string | null;
};

type ClientStatus = 'none' | 'pending' | 'approved' | 'not_logged_in';

export default function CoachPublicPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  
  const [coach, setCoach] = useState<Coach | null>(null);
  const [coachEmail, setCoachEmail] = useState<string>('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientStatus, setClientStatus] = useState<ClientStatus>('none');
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState<string>('');
  const [userEmail, setUserEmail] = useState<string>('');
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);
  const [requesting, setRequesting] = useState(false);
  
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestForm, setRequestForm] = useState({ name: '', email: '', message: '' });

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  useEffect(() => {
    loadCoachAndCheckStatus();
  }, [slug]);

  useEffect(() => {
    if (coach && clientStatus === 'approved') {
      fetchSlots();
    }
  }, [currentWeek, coach, clientStatus]);

  const loadCoachAndCheckStatus = async () => {
    const supabase = createClient();
    
    const { data: coachData, error } = await supabase
      .from('lesson_coaches')
      .select('id, display_name, slug, profile_id, email')
      .eq('slug', slug)
      .single();

    if (error || !coachData) {
      setLoading(false);
      return;
    }

    setCoach(coachData);
    if (coachData.email) {
      setCoachEmail(coachData.email);
    }

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      setClientStatus('not_logged_in');
      setLoading(false);
      return;
    }

    setUserEmail(user.email || '');

    const { data: client } = await supabase
      .from('lesson_clients')
      .select('id, name')
      .eq('profile_id', user.id)
      .single();

    if (!client) {
      setRequestForm(prev => ({
        ...prev,
        email: user.email || '',
        name: user.user_metadata?.full_name || ''
      }));
      setClientStatus('none');
      setLoading(false);
      return;
    }

    setClientId(client.id);
    setClientName(client.name || user.email || 'Client');

    const { data: relationship } = await supabase
      .from('lesson_client_coaches')
      .select('status')
      .eq('client_id', client.id)
      .eq('coach_id', coachData.id)
      .single();

    if (!relationship) {
      setClientStatus('none');
    } else if (relationship.status === 'pending') {
      setClientStatus('pending');
    } else if (relationship.status === 'approved') {
      setClientStatus('approved');
    }

    setLoading(false);
  };

  const fetchSlots = async () => {
    if (!coach) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_slots')
      .select('id, start_time, end_time, location, status')
      .eq('coach_id', coach.id)
      .eq('status', 'open')
      .gte('start_time', weekStart.toISOString())
      .lte('start_time', weekEnd.toISOString())
      .order('start_time');

    if (data) setSlots(data);
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.reload();
  };

  const requestToJoin = async () => {
    if (!coach) return;
    setRequesting(true);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push(`/login?redirect=/coach/${slug}`);
      return;
    }

    let currentClientId = clientId;
    
    if (!currentClientId) {
      const { data: newClient, error: clientError } = await supabase
        .from('lesson_clients')
        .insert({
          profile_id: user.id,
          name: requestForm.name || user.user_metadata?.full_name || user.email?.split('@')[0],
          email: requestForm.email || user.email
        })
        .select('id')
        .single();

      if (clientError || !newClient) {
        alert('Failed to create client profile. Please try again.');
        setRequesting(false);
        return;
      }
      currentClientId = newClient.id;
      setClientId(currentClientId);
    }

    const { error: relationError } = await supabase
      .from('lesson_client_coaches')
      .insert({
        client_id: currentClientId,
        coach_id: coach.id,
        status: 'pending'
      });

    if (relationError) {
      if (relationError.code === '23505') {
        alert('You have already requested to join this coach.');
      } else {
        alert('Failed to send request. Please try again.');
      }
      setRequesting(false);
      return;
    }

    setClientStatus('pending');
    setShowRequestForm(false);
    setRequesting(false);
  };

  const bookSlot = async () => {
    if (!selectedSlot || !clientId || !coach) return;
    setBooking(true);

    const supabase = createClient();
    
    const { data: currentSlot } = await supabase
      .from('lesson_slots')
      .select('status')
      .eq('id', selectedSlot.id)
      .single();

    if (currentSlot?.status !== 'open') {
      alert('Sorry, this slot was just booked by someone else.');
      setSelectedSlot(null);
      fetchSlots();
      setBooking(false);
      return;
    }

    const { error } = await supabase
      .from('lesson_slots')
      .update({
        status: 'booked',
        booked_by_client_id: clientId,
        booked_at: new Date().toISOString()
      })
      .eq('id', selectedSlot.id);

    if (error) {
      alert('Failed to book slot. Please try again.');
    } else {
      try {
        await fetch('/api/lessons/booking-notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coachEmail: coachEmail,
            coachName: coach.display_name,
            clientName: clientName,
            slotDate: format(parseISO(selectedSlot.start_time), 'EEEE, MMMM d, yyyy'),
            slotTime: format(parseISO(selectedSlot.start_time), 'h:mm a') + ' - ' + format(parseISO(selectedSlot.end_time), 'h:mm a')
          })
        });
      } catch (e) {
        console.error('Failed to send notification:', e);
      }

      setSelectedSlot(null);
router.push('/client/dashboard');
    }

    setBooking(false);
  };

  const getSlotsForDay = (date: Date) => {
    return slots.filter(slot => isSameDay(parseISO(slot.start_time), date));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!coach) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Coach Not Found</h1>
          <p className="text-gray-600 mb-4">We could not find a coach with that link.</p>
          <a href="/find-coach" className="text-blue-600 hover:underline">Search for your coach</a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <User className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold">{coach.display_name || 'Coach'}</h1>
                <p className="text-gray-500 text-sm">Tennis Coach</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {clientStatus === 'not_logged_in' ? (
                <a href={'/login?redirect=/coach/' + slug} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  Sign In
                </a>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">{userEmail}</span>
                  <button onClick={handleSignOut} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {clientStatus === 'not_logged_in' && (
          <div className="bg-white rounded-xl border p-6 text-center">
            <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Sign in to book lessons</h2>
            <p className="text-gray-600 mb-6">Create an account or sign in to request lessons with {coach.display_name}.</p>
            <div className="flex gap-3 justify-center">
              <a href={'/login?redirect=/coach/' + slug} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Sign In</a>
              <a href={'/register?redirect=/coach/' + slug} className="px-6 py-2 border rounded-lg hover:bg-gray-50">Create Account</a>
            </div>
          </div>
        )}

        {clientStatus === 'none' && (
          <div className="bg-white rounded-xl border p-6">
            <h2 className="text-xl font-semibold mb-2">Request to become a client</h2>
            <p className="text-gray-600 mb-6">Send a request to {coach.display_name} to start booking lessons.</p>
            
            {!showRequestForm ? (
              <button onClick={() => setShowRequestForm(true)} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                <Send className="h-4 w-4" />
                Request to Join
              </button>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                  <input type="text" value={requestForm.name} onChange={(e) => setRequestForm({ ...requestForm, name: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="John Smith" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input type="email" value={requestForm.email} onChange={(e) => setRequestForm({ ...requestForm, email: e.target.value })} className="w-full px-3 py-2 border rounded-lg" placeholder="john@example.com" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>
                  <textarea value={requestForm.message} onChange={(e) => setRequestForm({ ...requestForm, message: e.target.value })} className="w-full px-3 py-2 border rounded-lg" rows={3} placeholder="Hi! I would like to take lessons with you..." />
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowRequestForm(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={requestToJoin} disabled={requesting || !requestForm.name || !requestForm.email} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                    {requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {requesting ? 'Sending...' : 'Send Request'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {clientStatus === 'pending' && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6 text-center">
            <Clock className="h-12 w-12 text-yellow-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Request Pending</h2>
            <p className="text-gray-600">Your request to become a client of {coach.display_name} is pending approval.</p>
          </div>
        )}

        {clientStatus === 'approved' && (
          <div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <p className="text-green-800">You are approved! Select an available slot to book your lesson.</p>
            </div>

            <div className="bg-white rounded-xl border mb-6">
              <div className="p-4 border-b flex items-center justify-between">
                <button onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronLeft className="h-5 w-5" /></button>
                <h2 className="font-semibold">{format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}</h2>
                <button onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))} className="p-2 hover:bg-gray-100 rounded-lg"><ChevronRight className="h-5 w-5" /></button>
              </div>

              <div className="grid grid-cols-7 divide-x">
                {weekDays.map((day) => {
                  const daySlots = getSlotsForDay(day);
                  const isToday = isSameDay(day, new Date());
                  const isPast = day < new Date() && !isToday;

                  return (
                    <div key={day.toISOString()} className={`min-h-[180px] ${isPast ? 'bg-gray-50' : ''}`}>
                      <div className={`p-2 text-center border-b ${isToday ? 'bg-blue-50' : ''}`}>
                        <p className="text-xs text-gray-500">{format(day, 'EEE')}</p>
                        <p className={`text-lg font-semibold ${isToday ? 'text-blue-600' : isPast ? 'text-gray-400' : ''}`}>{format(day, 'd')}</p>
                      </div>
                      <div className="p-2 space-y-2">
                        {daySlots.length === 0 && !isPast && <p className="text-xs text-gray-400 text-center py-4">No slots</p>}
                        {daySlots.map((slot) => (
                          <button key={slot.id} onClick={() => setSelectedSlot(slot)} className="w-full p-2 bg-green-100 hover:bg-green-200 text-green-800 rounded-lg text-xs text-left transition-colors">
                            <p className="font-medium">{format(parseISO(slot.start_time), 'h:mm a')}</p>
                            {slot.location && <p className="truncate text-green-600">{slot.location}</p>}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>

      {selectedSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">Confirm Booking</h2>
            <div className="bg-blue-50 rounded-xl p-4 mb-6 space-y-3">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-blue-600" />
                <span className="font-medium">{format(parseISO(selectedSlot.start_time), 'EEEE, MMMM d, yyyy')}</span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-600" />
                <span>{format(parseISO(selectedSlot.start_time), 'h:mm a')} - {format(parseISO(selectedSlot.end_time), 'h:mm a')}</span>
              </div>
              {selectedSlot.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  <span>{selectedSlot.location}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setSelectedSlot(null)} className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={bookSlot} disabled={booking} className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2">
                {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                {booking ? 'Booking...' : 'Book Lesson'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

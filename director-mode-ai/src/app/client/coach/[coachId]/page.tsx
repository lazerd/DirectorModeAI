'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, ChevronLeft, ChevronRight, ArrowLeft, CheckCircle, Loader2 } from 'lucide-react';
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
};

export default function CoachCalendarPage() {
  const params = useParams();
  const router = useRouter();
  const coachId = params.coachId as string;
  
  const [coach, setCoach] = useState<Coach | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [booking, setBooking] = useState(false);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  useEffect(() => {
    checkAuthAndFetch();
  }, [coachId]);

  useEffect(() => {
    if (authorized && coachId) {
      fetchSlots();
    }
  }, [currentWeek, authorized, coachId]);

  const checkAuthAndFetch = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      router.push(`/login?redirect=/client/coach/${coachId}`);
      return;
    }

    // Get client record
    const { data: client } = await supabase
      .from('lesson_clients')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    if (!client) {
      router.push('/client/dashboard');
      return;
    }

    setClientId(client.id);

    // Check if approved for this coach
    const { data: relationship } = await supabase
      .from('lesson_client_coaches')
      .select('status')
      .eq('client_id', client.id)
      .eq('coach_id', coachId)
      .single();

    if (!relationship || relationship.status !== 'approved') {
      alert('You are not authorized to view this coach\'s calendar.');
      router.push('/client/dashboard');
      return;
    }

    // Get coach info
    const { data: coachData } = await supabase
      .from('lesson_coaches')
      .select('id, display_name')
      .eq('id', coachId)
      .single();

    if (coachData) {
      setCoach(coachData);
    }

    setAuthorized(true);
    setLoading(false);
  };

  const fetchSlots = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_slots')
      .select('id, start_time, end_time, location, status')
      .eq('coach_id', coachId)
      .eq('status', 'open')
      .gte('start_time', weekStart.toISOString())
      .lte('start_time', weekEnd.toISOString())
      .order('start_time');

    if (data) setSlots(data);
  };

  const bookSlot = async () => {
    if (!selectedSlot || !clientId) return;
    setBooking(true);

    const supabase = createClient();
    
    // Check if still available
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

    // Book the slot
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
      alert('🎉 Lesson booked successfully!');
      setSelectedSlot(null);
      fetchSlots();
      
      // TODO: Send confirmation email to client and notification to coach
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <button
            onClick={() => router.push('/client/dashboard')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </button>
          <h1 className="text-xl font-bold">{coach?.display_name || 'Coach'}'s Availability</h1>
          <p className="text-sm text-gray-500">Select an open slot to book your lesson</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* Calendar Navigation */}
        <div className="bg-white rounded-xl border mb-6">
          <div className="p-4 border-b flex items-center justify-between">
            <button
              onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h2 className="font-semibold">
              {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
            </h2>
            <button
              onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 divide-x">
            {weekDays.map((day) => {
              const daySlots = getSlotsForDay(day);
              const isToday = isSameDay(day, new Date());
              const isPast = day < new Date() && !isToday;

              return (
                <div key={day.toISOString()} className={`min-h-[180px] ${isPast ? 'bg-gray-50' : ''}`}>
                  <div className={`p-2 text-center border-b ${isToday ? 'bg-blue-50' : ''}`}>
                    <p className="text-xs text-gray-500">{format(day, 'EEE')}</p>
                    <p className={`text-lg font-semibold ${isToday ? 'text-blue-600' : isPast ? 'text-gray-400' : ''}`}>
                      {format(day, 'd')}
                    </p>
                  </div>

                  <div className="p-2 space-y-2">
                    {daySlots.length === 0 && !isPast && (
                      <p className="text-xs text-gray-400 text-center py-4">No slots</p>
                    )}
                    {daySlots.map((slot) => (
                      <button
                        key={slot.id}
                        onClick={() => setSelectedSlot(slot)}
                        className="w-full p-2 bg-green-100 hover:bg-green-200 text-green-800 rounded-lg text-xs text-left transition-colors"
                      >
                        <p className="font-medium">{format(parseISO(slot.start_time), 'h:mm a')}</p>
                        {slot.location && (
                          <p className="truncate text-green-600">{slot.location}</p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-sm text-gray-600">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-green-100 rounded" />
            <span>Available</span>
          </div>
        </div>
      </main>

      {/* Booking Modal */}
      {selectedSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">Confirm Booking</h2>
            
            <div className="bg-blue-50 rounded-xl p-4 mb-6 space-y-3">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-blue-600" />
                <span className="font-medium">
                  {format(parseISO(selectedSlot.start_time), 'EEEE, MMMM d, yyyy')}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-blue-600" />
                <span>
                  {format(parseISO(selectedSlot.start_time), 'h:mm a')} - {format(parseISO(selectedSlot.end_time), 'h:mm a')}
                </span>
              </div>
              {selectedSlot.location && (
                <div className="flex items-center gap-3">
                  <MapPin className="h-5 w-5 text-blue-600" />
                  <span>{selectedSlot.location}</span>
                </div>
              )}
            </div>

            <p className="text-sm text-gray-600 mb-6">
              You can cancel this booking up to 12 hours before the lesson.
            </p>

            <div className="flex gap-3">
              <button
                onClick={() => setSelectedSlot(null)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={bookSlot}
                disabled={booking}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {booking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Booking...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Book Lesson
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

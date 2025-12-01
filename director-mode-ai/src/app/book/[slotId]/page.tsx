'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Calendar, Clock, MapPin, CheckCircle, XCircle, Loader2, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  location: string | null;
  status: string;
  coach_id: string;
  coach: {
    display_name: string | null;
  };
};

export default function BookSlotPage() {
  const params = useParams();
  const router = useRouter();
  const slotId = params.slotId as string;
  
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [isApproved, setIsApproved] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [needsApproval, setNeedsApproval] = useState(false);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [accessRequested, setAccessRequested] = useState(false);

  useEffect(() => {
    checkAuthAndFetchSlot();
  }, [slotId]);

  const checkAuthAndFetchSlot = async () => {
    const supabase = createClient();
    
    // First fetch the slot details (public info)
    const { data: slotData, error: slotError } = await supabase
      .from('lesson_slots')
      .select('*, coach:lesson_coaches(display_name)')
      .eq('id', slotId)
      .single();

    if (slotError || !slotData) {
      setError('This lesson slot was not found.');
      setLoading(false);
      return;
    }

    if (slotData.status === 'booked') {
      setError('This slot has already been booked.');
      setLoading(false);
      return;
    }

    setSlot(slotData);

    // Check if user is logged in
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    // Get or create client record
    let { data: client } = await supabase
      .from('lesson_clients')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    if (!client) {
      const { data: newClient } = await supabase
        .from('lesson_clients')
        .insert({
          profile_id: user.id,
          name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Client',
          email: user.email
        })
        .select('id')
        .single();
      client = newClient;
    }

    if (client) {
      setClientId(client.id);

      // Check if approved for this coach
      const { data: relationship } = await supabase
        .from('lesson_client_coaches')
        .select('status')
        .eq('client_id', client.id)
        .eq('coach_id', slotData.coach_id)
        .single();

      if (!relationship) {
        setNeedsApproval(true);
      } else if (relationship.status === 'pending') {
        setAccessRequested(true);
      } else if (relationship.status === 'approved') {
        setIsApproved(true);
      } else {
        setNeedsApproval(true);
      }
    }

    setLoading(false);
  };

  const requestAccess = async () => {
    if (!clientId || !slot) return;
    setRequestingAccess(true);

    const supabase = createClient();
    await supabase.from('lesson_client_coaches').insert({
      client_id: clientId,
      coach_id: slot.coach_id,
      status: 'pending',
      requested_at: new Date().toISOString()
    });

    setAccessRequested(true);
    setRequestingAccess(false);
  };

  const bookSlot = async () => {
    if (!slot || !clientId) return;
    setBooking(true);

    const supabase = createClient();
    
    // Check if still available
    const { data: currentSlot } = await supabase
      .from('lesson_slots')
      .select('status')
      .eq('id', slot.id)
      .single();

    if (currentSlot?.status !== 'open') {
      setError('Sorry, this slot was just booked by someone else.');
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
      .eq('id', slot.id);

    if (error) {
      setError('Failed to book slot. Please try again.');
    } else {
      setBooked(true);
    }

    setBooking(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <XCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Oops!</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (booked) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-white flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Lesson Booked! 🎉</h1>
          <p className="text-gray-600 mb-6">
            You're all set for your lesson on<br />
            <strong>{slot && format(new Date(slot.start_time), 'EEEE, MMMM d')}</strong><br />
            at <strong>{slot && format(new Date(slot.start_time), 'h:mm a')}</strong>
          </p>
          <button
            onClick={() => router.push('/client/dashboard')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            View My Lessons
          </button>
        </div>
      </div>
    );
  }

  if (!slot) return null;

  const startDate = new Date(slot.start_time);
  const endDate = new Date(slot.end_time);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <User className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Book a Lesson</h1>
          <p className="text-gray-600">with {slot.coach?.display_name || 'Coach'}</p>
        </div>

        <div className="bg-blue-50 rounded-xl p-4 mb-6 space-y-3">
          <div className="flex items-center gap-3">
            <Calendar className="h-5 w-5 text-blue-600 flex-shrink-0" />
            <span className="font-medium">{format(startDate, 'EEEE, MMMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-blue-600 flex-shrink-0" />
            <span>{format(startDate, 'h:mm a')} - {format(endDate, 'h:mm a')}</span>
          </div>
          {slot.location && (
            <div className="flex items-center gap-3">
              <MapPin className="h-5 w-5 text-blue-600 flex-shrink-0" />
              <span>{slot.location}</span>
            </div>
          )}
        </div>

        {needsLogin ? (
          <div className="text-center">
            <p className="text-gray-600 mb-4">Please log in to book this lesson.</p>
            <button
              onClick={() => router.push(`/login?redirect=/book/${slotId}`)}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700"
            >
              Log In to Book
            </button>
            <p className="text-sm text-gray-500 mt-3">
              Don't have an account?{' '}
              <button onClick={() => router.push(`/register?redirect=/book/${slotId}`)} className="text-blue-600 hover:underline">
                Sign up
              </button>
            </p>
          </div>
        ) : needsApproval ? (
          <div className="text-center">
            <p className="text-gray-600 mb-4">
              You need to be approved by {slot.coach?.display_name || 'this coach'} before booking.
            </p>
            <button
              onClick={requestAccess}
              disabled={requestingAccess}
              className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {requestingAccess ? 'Sending Request...' : 'Request Access'}
            </button>
          </div>
        ) : accessRequested ? (
          <div className="text-center">
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
              <p className="text-yellow-800">
                Your request is pending approval from {slot.coach?.display_name || 'the coach'}.
                You'll be able to book once approved.
              </p>
            </div>
          </div>
        ) : isApproved ? (
          <>
            <p className="text-sm text-gray-600 mb-4 text-center">
              You can cancel up to 12 hours before the lesson.
            </p>
            <button
              onClick={bookSlot}
              disabled={booking}
              className="w-full py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {booking ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  Booking...
                </>
              ) : (
                <>
                  <CheckCircle className="h-5 w-5" />
                  Confirm Booking
                </>
              )}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

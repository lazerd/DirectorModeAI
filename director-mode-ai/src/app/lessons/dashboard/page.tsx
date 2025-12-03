'use client';

import { useState, useEffect } from 'react';
import { Calendar, Clock, Users, Send, Plus, Trash2, ChevronLeft, ChevronRight, Link, Check, Copy } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks, isSameDay } from 'date-fns';

type Slot = { 
  id: string; 
  start_time: string; 
  end_time: string; 
  location: string | null;
  status: string;
  notifications_sent: boolean;
};

type Client = { id: string; name: string; email: string; };

export default function DashboardPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [coachSlug, setCoachSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [newSlot, setNewSlot] = useState({ date: '', start_time: '09:00', end_time: '10:00', location: '' });
  const [copied, setCopied] = useState(false);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 0 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 0 });
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd });

  useEffect(() => { initCoach(); }, []);

  const initCoach = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    let { data: coach } = await supabase.from('lesson_coaches').select('id, slug').eq('profile_id', user.id).single();
    if (!coach) {
      const { data: newCoach } = await supabase.from('lesson_coaches').insert({ profile_id: user.id }).select('id, slug').single();
      coach = newCoach;
    }
    if (coach) { 
      setCoachId(coach.id);
      setCoachSlug(coach.slug);
      fetchSlots(coach.id); 
      fetchClients(coach.id); 
    }
  };

  const fetchSlots = async (coachId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_slots')
      .select('*')
      .eq('coach_id', coachId)
      .gte('start_time', weekStart.toISOString())
      .lte('start_time', weekEnd.toISOString())
      .order('start_time');
    if (data) setSlots(data);
    setLoading(false);
  };

  const fetchClients = async (coachId: string) => {
    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_clients')
      .select('id, name, email, lesson_client_coaches!inner(coach_id)')
      .eq('lesson_client_coaches.coach_id', coachId);
    if (data) setClients(data);
  };

  useEffect(() => {
    if (coachId) fetchSlots(coachId);
  }, [currentWeek, coachId]);

  const openAddSlot = (date: Date) => {
    setSelectedDate(date);
    setNewSlot({ ...newSlot, date: format(date, 'yyyy-MM-dd') });
    setShowAddSlot(true);
  };

  const calculateEndTime = (startTime: string): string => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const endHours = (hours + 1) % 24;
    return `${endHours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  const handleStartTimeChange = (startTime: string) => {
    const endTime = calculateEndTime(startTime);
    setNewSlot({ ...newSlot, start_time: startTime, end_time: endTime });
  };

  const addSlot = async () => {
    if (!coachId || !newSlot.date) return;
    const supabase = createClient();
    
    const [year, month, day] = newSlot.date.split('-').map(Number);
    const [startHour, startMinute] = newSlot.start_time.split(':').map(Number);
    const [endHour, endMinute] = newSlot.end_time.split(':').map(Number);
    
    const startDateTime = new Date(year, month - 1, day, startHour, startMinute);
    const endDateTime = new Date(year, month - 1, day, endHour, endMinute);
    
    await supabase.from('lesson_slots').insert({
      coach_id: coachId,
      start_time: startDateTime.toISOString(),
      end_time: endDateTime.toISOString(),
      location: newSlot.location || null,
      status: 'open'
    });
    setShowAddSlot(false);
    setNewSlot({ date: '', start_time: '09:00', end_time: '10:00', location: '' });
    fetchSlots(coachId);
  };

  const deleteSlot = async (slotId: string) => {
    if (!confirm('Delete this slot?')) return;
    const supabase = createClient();
    await supabase.from('lesson_slots').delete().eq('id', slotId);
    if (coachId) fetchSlots(coachId);
  };

  const copyShareLink = async () => {
    if (!coachSlug) {
      alert('Please set up your profile link in Settings first.');
      return;
    }
    const link = `${window.location.origin}/coach/${coachSlug}`;
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const unnotifiedSlots = slots.filter(s => s.status === 'open' && !s.notifications_sent);

  const sendBlast = async () => {
    if (unnotifiedSlots.length === 0 || clients.length === 0) return;
    setSending(true);
    
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      
      const response = await fetch('/api/lessons/blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId,
          slotIds: unnotifiedSlots.map(s => s.id),
          clientEmails: clients.map(c => c.email),
          coachName: user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Your Coach',
          coachEmail: user?.email,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        alert(`✅ Blast sent to ${result.sent} clients for ${unnotifiedSlots.length} slot${unnotifiedSlots.length > 1 ? 's' : ''}!`);
        if (coachId) fetchSlots(coachId);
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Blast error:', error);
      alert('❌ Failed to send blast. Check console for details.');
    }
    
    setSending(false);
  };

  const getSlotsForDay = (date: Date) => {
    return slots.filter(slot => {
      const slotDate = new Date(slot.start_time);
      return isSameDay(slotDate, date);
    });
  };

  return (
    <div className="p-6 lg:p-8">
      {/* Share Link Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link className="h-5 w-5 text-blue-600" />
          <div>
            <p className="font-medium text-blue-900">Share your booking link with students</p>
            {coachSlug ? (
              <p className="text-sm text-blue-600">director-mode-ai.vercel.app/coach/{coachSlug}</p>
            ) : (
              <p className="text-sm text-blue-600">Set up your link in <a href="/lessons/settings" className="underline">Settings</a></p>
            )}
          </div>
        </div>
        <button
          onClick={copyShareLink}
          disabled={!coachSlug}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy Link
            </>
          )}
        </button>
      </div>

      {/* Header with stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Clients</p>
          <p className="text-2xl font-bold">{clients.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Open Slots</p>
          <p className="text-2xl font-bold">{slots.filter(s => s.status === 'open').length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Ready to Blast</p>
          <p className="text-2xl font-bold text-orange-500">{unnotifiedSlots.length}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-sm text-gray-500">Booked</p>
          <p className="text-2xl font-bold text-green-600">{slots.filter(s => s.status === 'booked').length}</p>
        </div>
      </div>

      {/* Blast banner */}
      {unnotifiedSlots.length > 0 && clients.length > 0 && (
        <div className="bg-gradient-to-r from-orange-500 to-orange-600 text-white rounded-xl p-4 mb-6 flex items-center justify-between">
          <div>
            <p className="font-semibold">{unnotifiedSlots.length} slot{unnotifiedSlots.length > 1 ? 's' : ''} ready to blast!</p>
            <p className="text-sm text-orange-100">Notify your {clients.length} clients about availability</p>
          </div>
          <button
            onClick={sendBlast}
            disabled={sending}
            className="px-6 py-2 bg-white text-orange-600 rounded-lg font-semibold hover:bg-orange-50 disabled:opacity-50 flex items-center gap-2"
          >
            {sending ? (
              <div className="animate-spin h-5 w-5 border-2 border-orange-600 border-t-transparent rounded-full" />
            ) : (
              <Send size={18} />
            )}
            Send Blast
          </button>
        </div>
      )}

      {/* Calendar header */}
      <div className="bg-white rounded-xl border mb-6">
        <div className="p-4 border-b flex items-center justify-between">
          <button
            onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft size={20} />
          </button>
          <h2 className="font-semibold text-lg">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </h2>
          <button
            onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Calendar grid */}
        {loading ? (
          <div className="p-12 text-center">
            <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
          </div>
        ) : (
          <div className="grid grid-cols-7 divide-x">
            {weekDays.map((day) => {
              const daySlots = getSlotsForDay(day);
              const isToday = isSameDay(day, new Date());
              
              return (
                <div key={day.toISOString()} className="min-h-[200px]">
                  <div className={`p-2 text-center border-b ${isToday ? 'bg-blue-50' : ''}`}>
                    <p className="text-xs text-gray-500">{format(day, 'EEE')}</p>
                    <p className={`text-lg font-semibold ${isToday ? 'text-blue-600' : ''}`}>
                      {format(day, 'd')}
                    </p>
                  </div>
                  
                  <div className="p-2 space-y-2">
                    {daySlots.map((slot) => {
                      const startTime = new Date(slot.start_time);
                      return (
                        <div
                          key={slot.id}
                          className={`p-2 rounded-lg text-xs ${
                            slot.status === 'booked' 
                              ? 'bg-green-100 text-green-800' 
                              : slot.notifications_sent 
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-orange-100 text-orange-800'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              {format(startTime, 'h:mm a')}
                            </span>
                            <button
                              onClick={() => deleteSlot(slot.id)}
                              className="opacity-50 hover:opacity-100"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                          {slot.location && (
                            <p className="truncate">{slot.location}</p>
                          )}
                          {!slot.notifications_sent && slot.status === 'open' && (
                            <span className="text-[10px] bg-orange-200 px-1 rounded">NEW</span>
                          )}
                        </div>
                      );
                    })}
                    
                    <button
                      onClick={() => openAddSlot(day)}
                      className="w-full p-2 border-2 border-dashed border-gray-200 rounded-lg text-gray-400 hover:border-blue-400 hover:text-blue-500 flex items-center justify-center gap-1"
                    >
                      <Plus size={14} />
                      <span className="text-xs">Add</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Slot Modal */}
      {showAddSlot && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md">
            <h2 className="font-semibold text-lg mb-4">
              Add Open Slot - {selectedDate && format(selectedDate, 'EEEE, MMM d')}
            </h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                  <input
                    type="time"
                    value={newSlot.start_time}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                  <input
                    type="time"
                    value={newSlot.end_time}
                    onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Location (optional)</label>
                <input
                  type="text"
                  value={newSlot.location}
                  onChange={(e) => setNewSlot({ ...newSlot, location: e.target.value })}
                  placeholder="Court 1, Main Club"
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddSlot(false)}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={addSlot}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Add Slot
              </button>
            </div>
          </div>
        </div>
      )}

      {/* No clients warning */}
      {clients.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
          <p className="text-yellow-800">
            You need to{' '}
            <a href="/lessons/clients" className="underline font-medium">add clients</a>
            {' '}before you can send a blast.
          </p>
        </div>
      )}
    </div>
  );
}

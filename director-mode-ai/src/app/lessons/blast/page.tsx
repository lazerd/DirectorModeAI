'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Calendar, Clock, Users, Send, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Slot = { id: string; start_time: string; end_time: string; location: string | null; };
type Client = { id: string; name: string; email: string; };

export default function BlastPage() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [coachId, setCoachId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showAddSlot, setShowAddSlot] = useState(false);
  const [newSlot, setNewSlot] = useState({ date: format(new Date(), 'yyyy-MM-dd'), start_time: '09:00', end_time: '10:00', location: '' });

  useEffect(() => { initCoach(); }, []);

  const initCoach = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    let { data: coach } = await supabase.from('lesson_coaches').select('id').eq('profile_id', user.id).single();
    if (!coach) {
      const { data: newCoach } = await supabase.from('lesson_coaches').insert({ profile_id: user.id }).select('id').single();
      coach = newCoach;
    }
    if (coach) { setCoachId(coach.id); fetchSlots(coach.id); fetchClients(coach.id); }
  };

  const fetchSlots = async (coachId: string) => {
    const supabase = createClient();
    const { data } = await supabase.from('lesson_slots').select('*').eq('coach_id', coachId).eq('status', 'open').eq('notifications_sent', false).gte('start_time', new Date().toISOString()).order('start_time');
    if (data) setSlots(data);
    setLoading(false);
  };

  const fetchClients = async (coachId: string) => {
    const supabase = createClient();
    const { data } = await supabase.from('lesson_clients').select('id, name, email, lesson_client_coaches!inner(coach_id)').eq('lesson_client_coaches.coach_id', coachId);
    if (data) setClients(data);
  };

  const addSlot = async () => {
    if (!coachId) return;
    const supabase = createClient();
    await supabase.from('lesson_slots').insert({ coach_id: coachId, start_time: `${newSlot.date}T${newSlot.start_time}:00`, end_time: `${newSlot.date}T${newSlot.end_time}:00`, location: newSlot.location || null, status: 'open' });
    setShowAddSlot(false);
    fetchSlots(coachId);
  };

  const deleteSlot = async (slotId: string) => {
    const supabase = createClient();
    await supabase.from('lesson_slots').delete().eq('id', slotId);
    if (coachId) fetchSlots(coachId);
  };

  const sendBlast = async () => {
    if (slots.length === 0 || clients.length === 0) return;
    setSending(true);
    const supabase = createClient();
    await supabase.from('lesson_slots').update({ notifications_sent: true, notified_at: new Date().toISOString() }).in('id', slots.map(s => s.id));
    alert(`Blast sent to ${clients.length} clients for ${slots.length} slots!`);
    setSending(false);
    if (coachId) fetchSlots(coachId);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div><h1 className="font-semibold text-2xl">Email Blast</h1><p className="text-gray-500 text-sm">Notify clients about open slots</p></div>
        <button onClick={() => setShowAddSlot(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"><Plus size={18} />Add Slot</button>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><Calendar size={20} className="text-blue-600" /></div>
          <div><p className="text-sm text-gray-500">Slots to Send</p><p className="text-xl font-semibold">{slots.length}</p></div>
        </div>
        <div className="bg-white rounded-xl border p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center"><Users size={20} className="text-green-600" /></div>
          <div><p className="text-sm text-gray-500">Recipients</p><p className="text-xl font-semibold">{clients.length}</p></div>
        </div>
      </div>

      {showAddSlot && (
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="font-semibold text-lg mb-4">Add Open Slot</h2>
          <div className="grid sm:grid-cols-4 gap-4">
            <input type="date" value={newSlot.date} onChange={(e) => setNewSlot({ ...newSlot, date: e.target.value })} className="px-3 py-2 border rounded-lg" />
            <input type="time" value={newSlot.start_time} onChange={(e) => setNewSlot({ ...newSlot, start_time: e.target.value })} className="px-3 py-2 border rounded-lg" />
            <input type="time" value={newSlot.end_time} onChange={(e) => setNewSlot({ ...newSlot, end_time: e.target.value })} className="px-3 py-2 border rounded-lg" />
            <input type="text" value={newSlot.location} onChange={(e) => setNewSlot({ ...newSlot, location: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Location" />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setShowAddSlot(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
            <button onClick={addSlot} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Add Slot</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border mb-6">
        <div className="p-4 border-b"><h2 className="font-semibold">Slots Ready to Send</h2></div>
        {loading ? <div className="p-8 text-center"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" /></div>
        : slots.length === 0 ? <div className="p-8 text-center text-gray-500"><Calendar size={32} className="mx-auto mb-2 text-gray-300" />No slots to send.</div>
        : <div className="divide-y">{slots.map((slot) => (
          <div key={slot.id} className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center"><Clock size={18} className="text-blue-600" /></div>
              <div><p className="font-medium">{format(new Date(slot.start_time), 'EEEE, MMM d')}</p><p className="text-sm text-gray-500">{format(new Date(slot.start_time), 'h:mm a')} - {format(new Date(slot.end_time), 'h:mm a')}{slot.location && ` • ${slot.location}`}</p></div>
            </div>
            <button onClick={() => deleteSlot(slot.id)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
          </div>
        ))}</div>}
      </div>

      {slots.length > 0 && clients.length > 0 && (
        <button onClick={sendBlast} disabled={sending} className="w-full py-3 bg-green-500 text-white rounded-xl font-medium hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2">
          {sending ? <><div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />Sending...</> : <><Send size={20} />Send Blast to {clients.length} Clients</>}
        </button>
      )}

      {clients.length === 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-center">
          <p className="text-yellow-800">You need to <Link href="/lessons/clients" className="underline font-medium">add clients</Link> before you can send a blast.</p>
        </div>
      )}
    </div>
  );
}

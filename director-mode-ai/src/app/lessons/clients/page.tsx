'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Users, Mail, Phone, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Client = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClient, setNewClient] = useState({ name: '', email: '', phone: '' });
  const [coachId, setCoachId] = useState<string | null>(null);

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
    if (coach) { setCoachId(coach.id); fetchClients(coach.id); }
  };

  const fetchClients = async (coachId: string) => {
    const supabase = createClient();
    const { data } = await supabase.from('lesson_clients').select('*, lesson_client_coaches!inner(coach_id)').eq('lesson_client_coaches.coach_id', coachId).order('name');
    if (data) setClients(data);
    setLoading(false);
  };

  const addClient = async () => {
    if (!newClient.name || !newClient.email || !coachId) return;
    const supabase = createClient();
    const { data: client } = await supabase.from('lesson_clients').insert({ name: newClient.name, email: newClient.email, phone: newClient.phone || null }).select().single();
    if (client) {
      await supabase.from('lesson_client_coaches').insert({ client_id: client.id, coach_id: coachId });
      setNewClient({ name: '', email: '', phone: '' });
      setShowAddClient(false);
      fetchClients(coachId);
    }
  };

  const deleteClient = async (clientId: string) => {
    if (!confirm('Remove this client?')) return;
    const supabase = createClient();
    await supabase.from('lesson_clients').delete().eq('id', clientId);
    if (coachId) fetchClients(coachId);
  };

  const filteredClients = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="font-semibold text-2xl">My Clients</h1>
          <p className="text-gray-500 text-sm">Manage your lesson clients</p>
        </div>
        <button onClick={() => setShowAddClient(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
          <Plus size={18} />Add Client
        </button>
      </div>

      <div className="relative mb-6">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg" placeholder="Search clients..." />
      </div>

      {showAddClient && (
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="font-semibold text-lg mb-4">Add New Client</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <input type="text" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Name *" />
            <input type="email" value={newClient.email} onChange={(e) => setNewClient({ ...newClient, email: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Email *" />
            <input type="tel" value={newClient.phone} onChange={(e) => setNewClient({ ...newClient, phone: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Phone" />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setShowAddClient(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
            <button onClick={addClient} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add Client</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
      ) : filteredClients.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-semibold text-lg mb-2">No clients yet</h3>
          <p className="text-gray-500 mb-4">Add your first client to get started</p>
          <button onClick={() => setShowAddClient(true)} className="px-4 py-2 bg-blue-600 text-white rounded-lg">Add Client</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden divide-y">
          {filteredClients.map((client) => (
            <div key={client.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-semibold">{client.name.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <p className="font-medium">{client.name}</p>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1"><Mail size={14} />{client.email}</span>
                    {client.phone && <span className="flex items-center gap-1"><Phone size={14} />{client.phone}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => deleteClient(client.id)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

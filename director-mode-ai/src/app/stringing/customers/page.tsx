'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Users, Mail, Phone, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Customer = { id: string; full_name: string; email: string | null; phone: string | null; };

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ full_name: '', email: '', phone: '' });

  useEffect(() => { fetchCustomers(); }, []);

  const fetchCustomers = async () => {
    const supabase = createClient();
    const { data } = await supabase.from('stringing_customers').select('*').order('full_name');
    if (data) setCustomers(data);
    setLoading(false);
  };

  const addCustomer = async () => {
    if (!newCustomer.full_name) return;
    const supabase = createClient();
    await supabase.from('stringing_customers').insert({ full_name: newCustomer.full_name, email: newCustomer.email || null, phone: newCustomer.phone || null });
    setNewCustomer({ full_name: '', email: '', phone: '' });
    setShowAdd(false);
    fetchCustomers();
  };

  const deleteCustomer = async (id: string) => {
    if (!confirm('Delete this customer and all their data?')) return;
    const supabase = createClient();
    await supabase.from('stringing_customers').delete().eq('id', id);
    fetchCustomers();
  };

  const filtered = customers.filter(c => c.full_name.toLowerCase().includes(search.toLowerCase()) || (c.email && c.email.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div><h1 className="font-semibold text-2xl">Customers</h1><p className="text-gray-500 text-sm">Manage stringing customers</p></div>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"><Plus size={18} />Add Customer</button>
      </div>

      <div className="relative mb-6">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg" placeholder="Search customers..." />
      </div>

      {showAdd && (
        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="font-semibold text-lg mb-4">Add New Customer</h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <input type="text" value={newCustomer.full_name} onChange={(e) => setNewCustomer({ ...newCustomer, full_name: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Full Name *" />
            <input type="email" value={newCustomer.email} onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Email" />
            <input type="tel" value={newCustomer.phone} onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })} className="px-3 py-2 border rounded-lg" placeholder="Phone" />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-lg">Cancel</button>
            <button onClick={addCustomer} className="px-4 py-2 bg-purple-600 text-white rounded-lg">Add</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <Users size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-semibold text-lg mb-2">No customers yet</h3>
          <button onClick={() => setShowAdd(true)} className="px-4 py-2 bg-purple-600 text-white rounded-lg">Add Customer</button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden divide-y">
          {filtered.map((c) => (
            <div key={c.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                  <span className="text-purple-600 font-semibold">{c.full_name.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <p className="font-medium">{c.full_name}</p>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    {c.email && <span className="flex items-center gap-1"><Mail size={14} />{c.email}</span>}
                    {c.phone && <span className="flex items-center gap-1"><Phone size={14} />{c.phone}</span>}
                  </div>
                </div>
              </div>
              <button onClick={() => deleteCustomer(c.id)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Users, Mail, Phone, ChevronRight, Database, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import VaultPicker from '@/components/shared/VaultPicker';

type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ full_name: '', email: '', phone: '', notes: '' });
  const [alsoAddToVault, setAlsoAddToVault] = useState(false);
  const [showVaultPicker, setShowVaultPicker] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    fetchCustomers();
  }, []);

  const fetchCustomers = async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('stringing_customers')
      .select('*')
      .order('full_name');
    
    if (data) setCustomers(data);
    setLoading(false);
  };

  const addCustomer = async () => {
    if (!newCustomer.full_name) return;

    const supabase = createClient();
    const { error } = await supabase
      .from('stringing_customers')
      .insert({
        full_name: newCustomer.full_name,
        email: newCustomer.email || null,
        phone: newCustomer.phone || null,
        notes: newCustomer.notes || null,
      });

    if (error) {
      alert(`Failed to add customer: ${error.message}`);
      return;
    }

    // Optionally mirror into the PlayerVault so CourtConnect sees them too.
    if (alsoAddToVault) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        alert('Customer added, but could not add to PlayerVault: not signed in.');
      } else {
        const { error: vaultErr } = await supabase
          .from('cc_vault_players')
          .insert({
            director_id: user.id,
            full_name: newCustomer.full_name,
            email: newCustomer.email || null,
            phone: newCustomer.phone || null,
            notes: newCustomer.notes || null,
          });
        if (vaultErr) {
          alert(`Customer added, but PlayerVault sync failed: ${vaultErr.message}`);
        }
      }
    }

    setNewCustomer({ full_name: '', email: '', phone: '', notes: '' });
    setAlsoAddToVault(false);
    setShowAddCustomer(false);
    fetchCustomers();
  };

  const deleteCustomer = async (customer: Customer, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const confirmed = confirm(
      `Delete ${customer.full_name}? This also removes any rackets and stringing jobs tied to this customer. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(customer.id);
    const supabase = createClient();
    const { error } = await supabase
      .from('stringing_customers')
      .delete()
      .eq('id', customer.id);

    if (error) {
      alert(`Failed to delete customer: ${error.message}`);
      setDeletingId(null);
      return;
    }

    setCustomers(prev => prev.filter(c => c.id !== customer.id));
    setDeletingId(null);
  };

  const handleVaultImport = async (player: { full_name: string; email: string | null; phone: string | null; notes: string | null }) => {
    setShowVaultPicker(false);
    const supabase = createClient();
    const { error } = await supabase
      .from('stringing_customers')
      .insert({
        full_name: player.full_name,
        email: player.email || null,
        phone: player.phone || null,
        notes: player.notes || null,
      });
    if (!error) fetchCustomers();
  };

  const filteredCustomers = customers.filter(c =>
    c.full_name.toLowerCase().includes(search.toLowerCase()) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="p-6 lg:p-8">
      <div className="page-enter">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-semibold text-2xl">Customers</h1>
            <p className="text-gray-500 text-sm">Manage stringing customers</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowVaultPicker(true)}
              className="flex items-center gap-2 px-4 py-2 border border-white/10 text-white/70 rounded-lg font-medium hover:bg-white/5"
            >
              <Database size={18} />
              Import from Vault
            </button>
            <button
              onClick={() => setShowAddCustomer(true)}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
            >
              <Plus size={18} />
              Add Customer
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-6">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Search customers..."
          />
        </div>

        {/* Add Customer Form */}
        {showAddCustomer && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="font-semibold text-lg mb-4">Add New Customer</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Full Name *</label>
                <input
                  type="text"
                  value={newCustomer.full_name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, full_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="John Smith"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Phone</label>
                <input
                  type="tel"
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="(555) 123-4567"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <input
                  type="text"
                  value={newCustomer.notes}
                  onChange={(e) => setNewCustomer({ ...newCustomer, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="Any notes..."
                />
              </div>
            </div>
            <label className="flex items-center gap-2 mt-4 text-sm text-gray-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={alsoAddToVault}
                onChange={(e) => setAlsoAddToVault(e.target.checked)}
                className="w-4 h-4 accent-purple-600"
              />
              Also add to PlayerVault
              <span className="text-gray-400">(makes them available across CourtConnect and other modes)</span>
            </label>

            <div className="flex gap-3 mt-4">
              <button
                onClick={() => setShowAddCustomer(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={addCustomer}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
              >
                Add Customer
              </button>
            </div>
          </div>
        )}

        {/* Customers List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-purple-500 border-t-transparent rounded-full" />
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Users size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="font-semibold text-lg mb-2">No customers yet</h3>
            <p className="text-gray-500 mb-4">Add your first customer to get started</p>
            <button
              onClick={() => setShowAddCustomer(true)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
            >
              Add Customer
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="divide-y divide-gray-200">
              {filteredCustomers.map((customer) => (
                <Link
                  key={customer.id}
                  href={`/stringing/customers/${customer.id}`}
                  className="p-4 flex items-center justify-between hover:bg-gray-50 cursor-pointer block"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-purple-100 rounded-full flex items-center justify-center">
                      <span className="text-purple-600 font-semibold">
                        {customer.full_name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-purple-600 hover:underline">{customer.full_name}</p>
                      <div className="flex items-center gap-3 text-sm text-gray-500">
                        {customer.email && (
                          <span className="flex items-center gap-1">
                            <Mail size={14} />
                            {customer.email}
                          </span>
                        )}
                        {customer.phone && (
                          <span className="flex items-center gap-1">
                            <Phone size={14} />
                            {customer.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => deleteCustomer(customer, e)}
                      disabled={deletingId === customer.id}
                      className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg disabled:opacity-50"
                      title={`Delete ${customer.full_name}`}
                      aria-label={`Delete ${customer.full_name}`}
                    >
                      {deletingId === customer.id ? (
                        <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      ) : (
                        <Trash2 size={16} />
                      )}
                    </button>
                    <ChevronRight size={20} className="text-gray-400" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>

      {showVaultPicker && (
        <VaultPicker
          onSelect={handleVaultImport}
          onClose={() => setShowVaultPicker(false)}
        />
      )}
    </div>
  );
}

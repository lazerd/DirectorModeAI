'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Search, Users, Mail, Phone, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

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

    if (!error) {
      setNewCustomer({ full_name: '', email: '', phone: '', notes: '' });
      setShowAddCustomer(false);
      fetchCustomers();
    }
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
          <button
            onClick={() => setShowAddCustomer(true)}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700"
          >
            <Plus size={18} />
            Add Customer
          </button>
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
                  <ChevronRight size={20} className="text-gray-400" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

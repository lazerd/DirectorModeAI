'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Mail, Phone, User, Calendar, CheckCircle, Clock, Package } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Customer = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

type Job = {
  id: string;
  status: string;
  main_tension_lbs: number;
  cross_tension_lbs: number | null;
  custom_string_name: string | null;
  created_at: string;
  completed_at: string | null;
  picked_up_at: string | null;
  racket: {
    brand: string | null;
    model: string | null;
    string_pattern: string | null;
  } | null;
  string: {
    brand: string;
    name: string;
  } | null;
};

type Racket = {
  id: string;
  brand: string | null;
  model: string | null;
  string_pattern: string | null;
};

export default function CustomerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [rackets, setRackets] = useState<Racket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (params.id) {
      fetchCustomerData();
    }
  }, [params.id]);

  const fetchCustomerData = async () => {
    setLoading(true);
    const supabase = createClient();

    // Fetch customer
    const { data: customerData } = await supabase
      .from('stringing_customers')
      .select('*')
      .eq('id', params.id)
      .single();

    if (customerData) {
      setCustomer(customerData);

      // Fetch all jobs for this customer
      const { data: jobsData } = await supabase
        .from('stringing_jobs')
        .select(`
          *,
          racket:stringing_rackets(brand, model, string_pattern),
          string:stringing_catalog(brand, name)
        `)
        .eq('customer_id', params.id)
        .order('created_at', { ascending: false });

      if (jobsData) {
        setJobs(jobsData as Job[]);
      }

      // Fetch rackets
      const { data: racketsData } = await supabase
        .from('stringing_rackets')
        .select('*')
        .eq('customer_id', params.id);

      if (racketsData) {
        setRackets(racketsData);
      }
    }

    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-700',
      in_progress: 'bg-blue-100 text-blue-700',
      done: 'bg-green-100 text-green-700',
      picked_up: 'bg-gray-100 text-gray-700',
      cancelled: 'bg-red-100 text-red-700',
    };
    return styles[status] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="p-6 lg:p-8 flex items-center justify-center min-h-[400px]">
        <div className="spinner" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6 lg:p-8">
        <div className="card p-12 text-center">
          <User size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-display text-lg mb-2">Customer not found</h3>
          <Link href="/stringing/customers" className="btn btn-primary mt-4">
            Back to Customers
          </Link>
        </div>
      </div>
    );
  }

  const completedJobs = jobs.filter(j => j.status === 'picked_up' || j.status === 'done');
  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'in_progress');

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="page-enter">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.back()} className="btn btn-ghost btn-icon">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="font-display text-2xl">{customer.full_name}</h1>
            <p className="text-gray-500 text-sm">Customer since {format(new Date(customer.created_at), 'MMM yyyy')}</p>
          </div>
        </div>

        {/* Customer Info Card */}
        <div className="card p-6 mb-6">
          <h2 className="font-display text-lg mb-4">Contact Information</h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {customer.email && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-stringing-light flex items-center justify-center">
                  <Mail size={18} className="text-stringing" />
                </div>
                <div>
                  <div className="text-xs text-gray-500">Email</div>
                  <a href={`mailto:${customer.email}`} className="text-stringing hover:underline">
                    {customer.email}
                  </a>
                </div>
              </div>
            )}
            {customer.phone && (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-stringing-light flex items-center justify-center">
                  <Phone size={18} className="text-stringing" />
                </div>
                <div>
                  <div className="text-xs text-gray-500">Phone</div>
                  <a href={`tel:${customer.phone}`} className="hover:underline">
                    {customer.phone}
                  </a>
                </div>
              </div>
            )}
          </div>
          {customer.notes && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-xs text-gray-500 mb-1">Notes</div>
              <p className="text-gray-700">{customer.notes}</p>
            </div>
          )}
        </div>

        {/* Rackets */}
        {rackets.length > 0 && (
          <div className="card p-6 mb-6">
            <h2 className="font-display text-lg mb-4">Rackets on File</h2>
            <div className="space-y-2">
              {rackets.map((racket) => (
                <div key={racket.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                  <Package size={18} className="text-gray-400" />
                  <div>
                    <div className="font-medium">{racket.brand} {racket.model}</div>
                    {racket.string_pattern && (
                      <div className="text-sm text-gray-500">{racket.string_pattern}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="card p-4 text-center">
            <div className="text-3xl font-display text-stringing">{completedJobs.length}</div>
            <div className="text-sm text-gray-500">Completed Jobs</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-3xl font-display text-stringing">{activeJobs.length}</div>
            <div className="text-sm text-gray-500">Active Jobs</div>
          </div>
        </div>

        {/* Job History */}
        <div className="card p-6">
          <h2 className="font-display text-lg mb-4">Stringing History</h2>
          
          {jobs.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Clock size={32} className="mx-auto mb-2 text-gray-300" />
              <p>No stringing jobs yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const stringName = job.string 
                  ? `${job.string.brand} ${job.string.name}`
                  : job.custom_string_name || 'Custom string';
                
                const tension = job.cross_tension_lbs
                  ? `${job.main_tension_lbs}/${job.cross_tension_lbs} lbs`
                  : `${job.main_tension_lbs} lbs`;

                return (
                  <div key={job.id} className="p-4 border rounded-xl hover:border-stringing transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(job.status)}`}>
                            {job.status.replace('_', ' ')}
                          </span>
                          <span className="text-xs text-gray-400">
                            {format(new Date(job.created_at), 'MMM d, yyyy')}
                          </span>
                        </div>
                        
                        {job.racket && (
                          <div className="font-medium">
                            {job.racket.brand} {job.racket.model}
                            {job.racket.string_pattern && (
                              <span className="text-gray-400 font-normal"> ({job.racket.string_pattern})</span>
                            )}
                          </div>
                        )}
                        
                        <div className="text-sm text-gray-600 mt-1">
                          <span className="font-medium">{stringName}</span>
                          <span className="mx-2">•</span>
                          <span>{tension}</span>
                        </div>

                        {job.picked_up_at && (
                          <div className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                            <CheckCircle size={12} />
                            Picked up {format(new Date(job.picked_up_at), 'MMM d, yyyy')}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Quick Action */}
        <div className="mt-6">
          <Link 
            href={`/stringing/jobs/new?customer=${customer.id}`}
            className="btn btn-stringing w-full"
          >
            Create New Job for {customer.full_name}
          </Link>
        </div>
      </div>
    </div>
  );
}

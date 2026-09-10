'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Clock, Wrench, CheckCircle, Package, RefreshCw, Mail, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import NudgePanel from '@/components/campaigns/NudgePanel';
import { format, formatDistanceToNow } from 'date-fns';

type Job = {
  id: string;
  customer_id: string;
  status: string;
  main_tension_lbs: number;
  cross_tension_lbs: number | null;
  custom_string_name: string | null;
  quoted_ready_at: string | null;
  created_at: string;
  completed_at: string | null;
  picked_up_at: string | null;
  customer: {
    full_name: string;
    email: string | null;
  };
  racket: {
    brand: string | null;
    model: string | null;
  } | null;
  string: {
    brand: string;
    name: string;
    string_type?: string | null;
  } | null;
};

export default function StringingJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'done' | 'completed' | 'customers'>('all');
  const [customers, setCustomers] = useState<{ id: string; full_name: string }[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [restringDays, setRestringDays] = useState(90);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);

  useEffect(() => {
    fetchJobs();
  }, []);

  const fetchJobs = async () => {
    setLoading(true);
    const supabase = createClient();
    
    const { data, error } = await supabase
      .from('stringing_jobs')
      .select(`
        *,
        customer:stringing_customers(full_name, email),
        racket:stringing_rackets(brand, model),
        string:stringing_catalog(brand, name, string_type)
      `)
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setJobs(data as Job[]);
    }

    const { data: custData } = await supabase
      .from('stringing_customers')
      .select('id, full_name')
      .order('full_name');
    if (custData) setCustomers(custData);
    setLoading(false);
  };

  const sendNotificationEmail = async (job: Job) => {
    if (!job.customer?.email) {
      alert('No email address for this customer');
      return false;
    }

    setSendingEmail(job.id);
    
    try {
      const stringName = job.string 
        ? `${job.string.brand} ${job.string.name}`
        : job.custom_string_name || 'Custom string';
      
      const tension = job.cross_tension_lbs
        ? `${job.main_tension_lbs}/${job.cross_tension_lbs} lbs`
        : `${job.main_tension_lbs} lbs`;

      const racketInfo = job.racket 
        ? `${job.racket.brand || ''} ${job.racket.model || ''}`.trim()
        : 'N/A';

      const res = await fetch('/api/stringing/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: job.customer?.email,
          customerName: job.customer?.full_name,
          racketInfo,
          stringInfo: stringName,
          tension,
        }),
      });

      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      return true;
    } catch (err: any) {
      console.error('Email error:', err);
      alert('Failed to send email: ' + err.message);
      return false;
    } finally {
      setSendingEmail(null);
    }
  };

  const updateJobStatus = async (jobId: string, newStatus: string) => {
    const supabase = createClient();
    const job = jobs.find(j => j.id === jobId);
    
    // If marking as done, send email notification first
    if (newStatus === 'done' && job) {
      const emailSent = await sendNotificationEmail(job);
      if (!emailSent && job.customer?.email) {
        // Email failed but customer has email - ask if they want to continue
        if (!confirm('Email notification failed. Mark as ready anyway?')) {
          return;
        }
      }
    }

    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'done') {
      updates.completed_at = new Date().toISOString();
    } else if (newStatus === 'picked_up') {
      updates.picked_up_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('stringing_jobs')
      .update(updates)
      .eq('id', jobId);

    if (!error) {
      fetchJobs();
    }
  };

  // Board = active work; Completed = rackets already picked up, newest first.
  const activeJobs = jobs.filter(j => j.status !== 'picked_up');
  const completedJobs = jobs
    .filter(j => j.status === 'picked_up')
    .sort((a, b) => (b.picked_up_at || b.created_at).localeCompare(a.picked_up_at || a.created_at));
  const filteredJobs =
    filter === 'all' ? activeJobs
    : filter === 'completed' ? completedJobs
    : activeJobs.filter(j => j.status === filter);

  const pendingJobs = activeJobs.filter(j => j.status === 'pending');
  const inProgressJobs = activeJobs.filter(j => j.status === 'in_progress');
  const doneJobs = activeJobs.filter(j => j.status === 'done');

  // Latest job per customer (jobs are newest-first) — "how did they string it last time?"
  const lastJobByCustomer = new Map<string, Job>();
  for (const j of jobs) if (!lastJobByCustomer.has(j.customer_id)) lastJobByCustomer.set(j.customer_id, j);
  const q = customerSearch.trim().toLowerCase();
  const customerList = customers
    .filter(c => !q || (c.full_name || '').toLowerCase().includes(q))
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '', undefined, { sensitivity: 'base' }));

  return (
    <div className="p-6 lg:p-8">
      <div className="page-enter">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-2xl sm:text-3xl mb-1">Job Board</h1>
            <p className="text-gray-500">Manage stringing jobs</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={fetchJobs} className="btn btn-ghost btn-icon">
              <RefreshCw size={18} />
            </button>
            <Link href="/stringing/jobs/new" className="btn btn-stringing">
              <Plus size={18} />
              New Job
            </Link>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard
            icon={Clock}
            label="Pending"
            value={pendingJobs.length}
            color="warning"
          />
          <StatCard
            icon={Wrench}
            label="In Progress"
            value={inProgressJobs.length}
            color="primary"
          />
          <StatCard
            icon={CheckCircle}
            label="Ready for Pickup"
            value={doneJobs.length}
            color="success"
          />
        </div>

        {/* Pickup reminders — only the "your racket is ready" email belongs here */}
        <section className="mb-6">
          <NudgePanel
            surface="stringing"
            targetId="me"
            only={['nudge']}
            nudgeCopy={{
              title: '📬 Tell them it’s ready',
              desc: 'Email every customer whose racket is done but hasn’t been picked up yet. Preview or send a test to yourself first.',
              empty: 'No finished rackets waiting for pickup.',
            }}
          />
        </section>

        {/* Filter Tabs */}
        <div className="tabs mb-6 inline-flex flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`tab ${filter === 'all' ? 'tab-active' : ''}`}
          >
            All ({activeJobs.length})
          </button>
          <button
            onClick={() => setFilter('pending')}
            className={`tab ${filter === 'pending' ? 'tab-active' : ''}`}
          >
            Pending ({pendingJobs.length})
          </button>
          <button
            onClick={() => setFilter('in_progress')}
            className={`tab ${filter === 'in_progress' ? 'tab-active' : ''}`}
          >
            In Progress ({inProgressJobs.length})
          </button>
          <button
            onClick={() => setFilter('done')}
            className={`tab ${filter === 'done' ? 'tab-active' : ''}`}
          >
            Ready ({doneJobs.length})
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`tab ${filter === 'completed' ? 'tab-active' : ''}`}
          >
            Completed ({completedJobs.length})
          </button>
          <button
            onClick={() => setFilter('customers')}
            className={`tab ${filter === 'customers' ? 'tab-active' : ''}`}
          >
            Customers ({customers.length})
          </button>
        </div>

        {/* Jobs List (or the Customers tab) */}
        {filter === 'customers' ? (
          <CustomersView
            customers={customerList}
            lastJob={lastJobByCustomer}
            search={customerSearch}
            onSearch={setCustomerSearch}
            restringDays={restringDays}
            onRestringDays={setRestringDays}
          />
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="spinner" />
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="card p-12 text-center">
            <Package size={48} className="mx-auto text-gray-300 mb-4" />
            <h3 className="font-display text-lg mb-2">No jobs found</h3>
            <p className="text-gray-500 mb-4">
              {filter === 'all' 
                ? "Create your first stringing job to get started."
                : `No ${filter.replace('_', ' ')} jobs at the moment.`}
            </p>
            {filter === 'all' && (
              <Link href="/stringing/jobs/new" className="btn btn-stringing">
                <Plus size={18} />
                New Job
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onStatusChange={updateJobStatus}
                onSendReminder={sendNotificationEmail}
                sendingEmail={sendingEmail === job.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CustomersView({
  customers,
  lastJob,
  search,
  onSearch,
  restringDays,
  onRestringDays,
}: {
  customers: { id: string; full_name: string }[];
  lastJob: Map<string, Job>;
  search: string;
  onSearch: (v: string) => void;
  restringDays: number;
  onRestringDays: (d: number) => void;
}) {
  const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return (
    <div className="space-y-4">
    {/* Re-string reminder */}
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-2 text-sm text-gray-400">
        <span>Remind customers whose last string job was</span>
        <select
          value={restringDays}
          onChange={(e) => onRestringDays(Number(e.target.value))}
          className="input w-auto py-1"
        >
          {[30, 60, 90, 120, 180, 365].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <span>or more days ago</span>
      </div>
      <NudgePanel
        surface="stringing-restring"
        targetId={String(restringDays)}
        only={['nudge']}
        nudgeCopy={{
          title: '🔁 Time for a re-string?',
          desc: `Emails each customer how many days it's been, with their last string and tension, and suggests bringing the racket back in. Skips anyone whose racket is in the shop right now.`,
          empty: `Nobody is past ${restringDays} days right now.`,
        }}
      />
    </div>
    <div className="card p-4">
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="input pl-9"
          placeholder="Find a customer…"
        />
      </div>
      {customers.length === 0 ? (
        <p className="text-sm text-gray-500">No customers found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-white/10">
                <th className="py-2 pr-4 font-medium">Customer</th>
                <th className="py-2 pr-4 font-medium">Last tension</th>
                <th className="py-2 pr-4 font-medium">String</th>
                <th className="py-2 font-medium">Last visit</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const last = lastJob.get(c.id);
                const type = last?.string?.string_type?.replace('_', ' ');
                return (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2.5 pr-4">
                      <Link href={`/stringing/customers/${c.id}`} className="font-medium hover:text-stringing transition-colors">
                        {c.full_name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">{last ? tensionLabel(last) : '—'}</td>
                    <td className="py-2.5 pr-4">
                      {last ? (
                        <>
                          {stringLabel(last)}
                          {type && <span className="text-gray-500"> · {type}</span>}
                        </>
                      ) : (
                        <span className="text-gray-500">No jobs yet</span>
                      )}
                    </td>
                    <td className="py-2.5 whitespace-nowrap text-gray-500">
                      {last && (
                        <>
                          {format(new Date(last.created_at), 'MMM d, yyyy')}
                          <span className={daysSince(last.created_at) >= restringDays ? 'text-amber-400' : ''}>
                            {' '}· {daysSince(last.created_at)} days ago
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </div>
  );
}

function stringLabel(job: Job) {
  return job.string ? `${job.string.brand} ${job.string.name}` : job.custom_string_name || 'Custom string';
}

function tensionLabel(job: Job) {
  return job.cross_tension_lbs ? `${job.main_tension_lbs}/${job.cross_tension_lbs} lbs` : `${job.main_tension_lbs} lbs`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: 'primary' | 'success' | 'warning';
}) {
  const colors = {
    primary: 'bg-primary-light text-primary',
    success: 'bg-success-light text-success',
    warning: 'bg-warning-light text-warning',
  };

  return (
    <div className="card p-4 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${colors[color]}`}>
        <Icon size={22} />
      </div>
      <div>
        <div className="text-sm text-gray-500">{label}</div>
        <div className="text-2xl font-display">{value}</div>
      </div>
    </div>
  );
}

function JobCard({
  job,
  onStatusChange,
  onSendReminder,
  sendingEmail,
}: {
  job: Job;
  onStatusChange: (id: string, status: string) => void;
  onSendReminder: (job: Job) => Promise<boolean>;
  sendingEmail: boolean;
}) {
  const statusColors = {
    pending: 'badge-warning',
    in_progress: 'badge-primary',
    done: 'badge-success',
    picked_up: 'badge-success',
  };

  const stringName = job.string 
    ? `${job.string.brand} ${job.string.name}`
    : job.custom_string_name || 'Custom string';

  const tension = job.cross_tension_lbs
    ? `${job.main_tension_lbs}/${job.cross_tension_lbs} lbs`
    : `${job.main_tension_lbs} lbs`;

  return (
    <div className="card p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <Link 
              href={`/stringing/customers/${job.customer_id}`}
              className="font-display text-lg hover:text-stringing transition-colors"
            >
              {job.customer?.full_name || 'Unknown customer'}
            </Link>
            <span className={`badge ${statusColors[job.status as keyof typeof statusColors]}`}>
              {job.status === 'picked_up' ? 'completed' : job.status.replace('_', ' ')}
            </span>
            {job.customer?.email && (
              <Mail size={14} className="text-gray-400" />
            )}
          </div>
          
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
            {job.racket && (
              <span>{job.racket.brand} {job.racket.model}</span>
            )}
            <span className="font-medium">{stringName}</span>
            <span>{tension}</span>
          </div>
          
          <div className="text-xs text-gray-600 mt-2">
            Created {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            {job.status === 'picked_up' && job.picked_up_at && (
              <> • Picked up {format(new Date(job.picked_up_at), 'EEE, MMM d')}</>
            )}
            {job.status !== 'picked_up' && job.quoted_ready_at && (
              <> • Due {format(new Date(job.quoted_ready_at), 'EEE, MMM d')} ({formatDistanceToNow(new Date(job.quoted_ready_at), { addSuffix: true })})</>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {job.status === 'pending' && (
            <button
              onClick={() => onStatusChange(job.id, 'in_progress')}
              className="btn btn-sm btn-primary"
            >
              Start
            </button>
          )}
          {job.status === 'in_progress' && (
            <button
              onClick={() => onStatusChange(job.id, 'done')}
              className="btn btn-sm btn-success"
              disabled={sendingEmail}
            >
              {sendingEmail ? 'Sending...' : 'Done'}
            </button>
          )}
          {job.status === 'done' && (
            <>
              {job.customer?.email && (
                <button
                  onClick={async () => {
                    const ok = await onSendReminder(job);
                    if (ok) alert(`Reminder email sent to ${job.customer?.full_name}.`);
                  }}
                  className="btn btn-sm btn-ghost"
                  disabled={sendingEmail}
                  title={`Send pickup reminder to ${job.customer?.email}`}
                >
                  <Mail size={14} />
                  {sendingEmail ? 'Sending...' : 'Remind'}
                </button>
              )}
              <button
                onClick={() => onStatusChange(job.id, 'picked_up')}
                className="btn btn-sm btn-secondary"
              >
                Picked Up
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

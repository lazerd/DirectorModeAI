'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Clock, Wrench, CheckCircle, Package, RefreshCw, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatDistanceToNow } from 'date-fns';

type Job = {
  id: string;
  status: string;
  main_tension_lbs: number;
  cross_tension_lbs: number | null;
  custom_string_name: string | null;
  quoted_ready_at: string | null;
  created_at: string;
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
  } | null;
};

export default function StringingJobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'done'>('all');
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
        string:stringing_catalog(brand, name)
      `)
      .not('status', 'eq', 'picked_up')
      .not('status', 'eq', 'cancelled')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setJobs(data as Job[]);
    }
    setLoading(false);
  };

  const sendNotificationEmail = async (job: Job) => {
    if (!job.customer.email) {
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
          to: job.customer.email,
          customerName: job.customer.full_name,
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
      if (!emailSent && job.customer.email) {
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

  const filteredJobs = jobs.filter(job => {
    if (filter === 'all') return true;
    return job.status === filter;
  });

  const pendingJobs = jobs.filter(j => j.status === 'pending');
  const inProgressJobs = jobs.filter(j => j.status === 'in_progress');
  const doneJobs = jobs.filter(j => j.status === 'done');

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

        {/* Filter Tabs */}
        <div className="tabs mb-6 inline-flex">
          <button
            onClick={() => setFilter('all')}
            className={`tab ${filter === 'all' ? 'tab-active' : ''}`}
          >
            All ({jobs.length})
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
        </div>

        {/* Jobs List */}
        {loading ? (
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
                sendingEmail={sendingEmail === job.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
  sendingEmail,
}: {
  job: Job;
  onStatusChange: (id: string, status: string) => void;
  sendingEmail: boolean;
}) {
  const statusColors = {
    pending: 'badge-warning',
    in_progress: 'badge-primary',
    done: 'badge-success',
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
            <span className="font-display text-lg">
              {job.customer.full_name}
            </span>
            <span className={`badge ${statusColors[job.status as keyof typeof statusColors]}`}>
              {job.status.replace('_', ' ')}
            </span>
            {job.customer.email && (
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
          
          <div className="text-xs text-gray-400 mt-2">
            Created {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
            {job.quoted_ready_at && (
              <> • Due {formatDistanceToNow(new Date(job.quoted_ready_at), { addSuffix: true })}</>
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
            <button
              onClick={() => onStatusChange(job.id, 'picked_up')}
              className="btn btn-sm btn-secondary"
            >
              Picked Up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { History, Calendar, Users, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Blast = {
  id: string;
  sent_at: string;
  recipients_count: number;
  slots_count: number;
  subject: string | null;
};

export default function HistoryPage() {
  const [blasts, setBlasts] = useState<Blast[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBlasts();
  }, []);

  const fetchBlasts = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: coach } = await supabase
      .from('lesson_coaches')
      .select('id')
      .eq('profile_id', user.id)
      .single();

    if (coach) {
      const { data } = await supabase
        .from('lesson_blasts')
        .select('*')
        .eq('coach_id', coach.id)
        .order('sent_at', { ascending: false });
      
      if (data) setBlasts(data);
    }
    setLoading(false);
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6">
        <h1 className="font-semibold text-2xl">Blast History</h1>
        <p className="text-gray-500 text-sm">View your past email notifications</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : blasts.length === 0 ? (
        <div className="bg-white rounded-xl border p-12 text-center">
          <History size={48} className="mx-auto text-gray-300 mb-4" />
          <h3 className="font-semibold text-lg mb-2">No blasts yet</h3>
          <p className="text-gray-500">Your email blast history will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden divide-y">
          {blasts.map((blast) => (
            <div key={blast.id} className="p-4 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <Mail size={18} className="text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {format(new Date(blast.sent_at), 'EEEE, MMMM d, yyyy')}
                    </p>
                    <p className="text-sm text-gray-500">
                      {format(new Date(blast.sent_at), 'h:mm a')}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar size={16} />
                    <span>{blast.slots_count} slots</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                    <Users size={16} />
                    <span>{blast.recipients_count} recipients</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

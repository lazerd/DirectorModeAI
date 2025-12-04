'use client';

import { useState } from 'react';
import { Search, User } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import Link from 'next/link';

type Coach = {
  id: string;
  display_name: string;
  slug: string;
};

export default function FindCoachPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [coaches, setCoaches] = useState<Coach[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);

  const searchCoaches = async () => {
    if (!searchQuery.trim()) return;
    
    setLoading(true);
    setSearched(true);
    
    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_coaches')
      .select('id, display_name, slug')
      .ilike('display_name', `%${searchQuery}%`)
      .not('slug', 'is', null)
      .limit(10);

    setCoaches(data || []);
    setLoading(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      searchCoaches();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/client/dashboard" className="font-bold text-xl text-blue-600">LastMinute</Link>
          <Link href="/client/dashboard" className="text-sm text-gray-600 hover:text-blue-600">
            ← Back to My Lessons
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Find Your Coach</h1>
          <p className="text-gray-600">Search for your tennis coach to book lessons</p>
        </div>

        {/* Search */}
        <div className="bg-white rounded-xl border p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Search by coach name</label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Search coach name..."
                className="w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={searchCoaches}
              disabled={loading || !searchQuery.trim()}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Results */}
        {searched && (
          <div className="bg-white rounded-xl border">
            {coaches.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <p>No coaches found matching "{searchQuery}"</p>
                <p className="text-sm mt-2">Ask your coach to share their booking link with you.</p>
              </div>
            ) : (
              <div className="divide-y">
                {coaches.map((coach) => (
                  <Link
                    key={coach.id}
                    href={`/coach/${coach.slug}`}
                    className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                      <User className="h-6 w-6 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold">{coach.display_name}</h3>
                      <p className="text-sm text-gray-500">Tennis Coach</p>
                    </div>
                    <span className="text-blue-600 text-sm">View →</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-center text-sm text-gray-500 mt-6">
          Can't find your coach? Ask them to share their booking link with you.
        </p>
      </main>
    </div>
  );
}

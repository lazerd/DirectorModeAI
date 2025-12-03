'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, User, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

type Coach = {
  id: string;
  display_name: string | null;
  slug: string;
};

export default function FindCoachPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<Coach[]>([]);
  const [searched, setSearched] = useState(false);
  const [directCode, setDirectCode] = useState('');

  const searchCoaches = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearched(true);

    const supabase = createClient();
    const { data } = await supabase
      .from('lesson_coaches')
      .select('id, display_name, slug')
      .or(`display_name.ilike.%${searchQuery}%,slug.ilike.%${searchQuery}%`)
      .not('slug', 'is', null)
      .limit(10);

    setResults(data || []);
    setSearching(false);
  };

  const goToCoach = (slug: string) => {
    router.push(`/coach/${slug}`);
  };

  const handleDirectCode = () => {
    if (!directCode.trim()) return;
    const cleanSlug = directCode.trim().toLowerCase().replace(/\s+/g, '-');
    router.push(`/coach/${cleanSlug}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="bg-white border-b">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <a href="/" className="text-xl font-bold text-blue-600">
            Last Minute Lessons
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-3">
            Find Your Coach
          </h1>
          <p className="text-gray-600 text-lg">
            Search for your tennis coach to book lessons
          </p>
        </div>

        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="font-semibold mb-3">Have a coach code or link?</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={directCode}
              onChange={(e) => setDirectCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleDirectCode()}
              placeholder="Enter coach code (e.g., darrin-cohen)"
              className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleDirectCode}
              disabled={!directCode.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              Go
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 border-t" />
          <span className="text-gray-400 text-sm">or</span>
          <div className="flex-1 border-t" />
        </div>

        <div className="bg-white rounded-xl border p-6 mb-6">
          <h2 className="font-semibold mb-3">Search by coach name</h2>
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchCoaches()}
                placeholder="Search coach name..."
                className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <button
              onClick={searchCoaches}
              disabled={!searchQuery.trim() || searching}
              className="px-6 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {searching ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searched && (
            <div className="mt-6">
              {results.length === 0 ? (
                <p className="text-gray-500 text-center py-4">
                  No coaches found for "{searchQuery}"
                </p>
              ) : (
                <div className="space-y-2">
                  {results.map((coach) => (
                    <button
                      key={coach.id}
                      onClick={() => goToCoach(coach.slug)}
                      className="w-full p-4 border rounded-lg hover:bg-gray-50 flex items-center gap-4 text-left transition-colors"
                    >
                      <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                        <User className="h-6 w-6 text-blue-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{coach.display_name || 'Coach'}</p>
                        <p className="text-sm text-gray-500">@{coach.slug}</p>
                      </div>
                      <ArrowRight className="h-5 w-5 text-gray-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-center text-gray-500 text-sm">
          Can't find your coach? Ask them to share their booking link with you.
        </p>
      </main>
    </div>
  );
}

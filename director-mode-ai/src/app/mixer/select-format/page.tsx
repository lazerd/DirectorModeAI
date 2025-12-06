'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, Trophy, Sparkles, Swords } from 'lucide-react';

interface FormatOption {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: 'mixer' | 'tournament' | 'team';
}

export default function SelectFormatPage() {
  const router = useRouter();
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);

  const formats: FormatOption[] = [
    {
      id: 'doubles',
      name: 'Doubles',
      description: '4 players per court. Teams rotate each round for balanced play.',
      icon: '👥',
      category: 'mixer',
    },
    {
      id: 'singles',
      name: 'Singles',
      description: '2 players per court. Head-to-head matchups.',
      icon: '🎾',
      category: 'mixer',
    },
    {
      id: 'mixed-doubles',
      name: 'Mixed Doubles',
      description: '4 players per court. One male, one female per team.',
      icon: '👫',
      category: 'mixer',
    },
    {
      id: 'king-of-court',
      name: 'King of the Court',
      description: 'Winners stay, losers rotate. Continuous play format.',
      icon: '👑',
      category: 'mixer',
    },
    {
      id: 'round-robin',
      name: 'Team Round Robin',
      description: 'Fixed teams compete against all other teams.',
      icon: '🔄',
      category: 'mixer',
    },
    {
      id: 'maximize-courts',
      name: 'Maximize Courts',
      description: 'Fills all courts optimally with mixed singles/doubles.',
      icon: '🎯',
      category: 'mixer',
    },
    {
      id: 'single-elimination-singles',
      name: 'Singles Tournament',
      description: 'Traditional bracket. 1v1 matches, win or go home.',
      icon: '🏆',
      category: 'tournament',
    },
    {
      id: 'single-elimination-doubles',
      name: 'Doubles Tournament',
      description: 'Traditional bracket. 2v2 team matches, win or go home.',
      icon: '🏅',
      category: 'tournament',
    },
    {
      id: 'team-battle',
      name: 'Team Battle',
      description: 'Two named teams compete! Flexible singles/doubles mix. Team with most match wins takes the victory.',
      icon: '⚔️',
      category: 'team',
    },
  ];

  const mixerFormats = formats.filter(f => f.category === 'mixer');
  const tournamentFormats = formats.filter(f => f.category === 'tournament');
  const teamFormats = formats.filter(f => f.category === 'team');

  const handleFormatClick = (formatId: string) => {
    setSelectedFormat(formatId);
    router.push(`/mixer/events/new?format=${formatId}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-orange-50">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <Link href="/mixer/home" className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900">
            <ArrowLeft size={18} />
            Back to Events
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-2xl border-2 border-blue-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="text-blue-600" size={24} />
            <h2 className="text-xl font-bold">Get AI Tournament Recommendation</h2>
          </div>
          <p className="text-gray-600 mb-4">
            Not sure which format to choose? Let AI analyze your event details and recommend the perfect format.
          </p>
          <button className="w-full py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 flex items-center justify-center gap-2">
            <Sparkles size={20} />
            Get AI Recommendation
          </button>
        </div>

        {/* Team Battle - Featured */}
        <div className="bg-white rounded-2xl border-2 border-red-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Swords className="text-red-500" size={24} />
            <h2 className="text-xl font-bold">Team Competition</h2>
            <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded-full">NEW</span>
          </div>
          <p className="text-gray-600 mb-6">Two teams battle it out across multiple rounds!</p>
          
          <div className="grid gap-4 md:grid-cols-1">
            {teamFormats.map((format) => (
              <button
                key={format.id}
                onClick={() => handleFormatClick(format.id)}
                className={`p-5 rounded-xl border-2 text-left transition-all hover:shadow-lg hover:border-red-400 ${
                  selectedFormat === format.id ? 'border-red-500 bg-red-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-4xl">{format.icon}</span>
                  <div>
                    <h3 className="font-bold text-xl">{format.name}</h3>
                    <p className="text-sm text-gray-600">{format.description}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border-2 border-orange-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Users className="text-orange-500" size={24} />
            <h2 className="text-xl font-bold">Mixers/Socials</h2>
          </div>
          <p className="text-gray-600 mb-6">Casual play formats focused on rotation and social interaction</p>
          
          <div className="grid gap-4 md:grid-cols-2">
            {mixerFormats.map((format) => (
              <button
                key={format.id}
                onClick={() => handleFormatClick(format.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-lg hover:border-orange-400 ${
                  selectedFormat === format.id ? 'border-orange-500 bg-orange-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl">{format.icon}</span>
                  <h3 className="font-bold text-lg">{format.name}</h3>
                </div>
                <p className="text-sm text-gray-600">{format.description}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl border-2 border-yellow-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <Trophy className="text-yellow-500" size={24} />
            <h2 className="text-xl font-bold">Tournament Formats</h2>
          </div>
          <p className="text-gray-600 mb-6">Competitive formats with brackets and elimination rounds</p>
          
          <div className="grid gap-4 md:grid-cols-2">
            {tournamentFormats.map((format) => (
              <button
                key={format.id}
                onClick={() => handleFormatClick(format.id)}
                className={`p-4 rounded-xl border-2 text-left transition-all hover:shadow-lg hover:border-yellow-400 ${
                  selectedFormat === format.id ? 'border-yellow-500 bg-yellow-50' : 'border-gray-200'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-3xl">{format.icon}</span>
                  <div>
                    <h3 className="font-bold text-lg">{format.name}</h3>
                  </div>
                </div>
                <p className="text-sm text-gray-600">{format.description}</p>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}

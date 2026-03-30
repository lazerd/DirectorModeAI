'use client';

import { useState, useEffect } from 'react';
import {
  Database, Users, Shuffle, Clock, Wrench, Globe,
  ArrowRight, Check, Upload, Search, Mail, Zap, BarChart3
} from 'lucide-react';

const FEATURES = [
  {
    id: 'vault',
    tag: 'PlayerVault',
    tagColor: 'bg-[#D3FB52]/10 text-[#D3FB52]',
    title: 'Import your entire roster in seconds',
    description: 'CSV upload, UTR auto-lookup, NTRP ratings — your whole club in one database.',
    icon: Database,
    iconColor: 'text-[#D3FB52]',
    iconBg: 'bg-[#D3FB52]/10',
    mockup: [
      { type: 'row', name: 'Sarah Johnson', rating: '4.5', utr: '8.72', sport: 'Tennis' },
      { type: 'row', name: 'Mike Chen', rating: '3.5', utr: '6.10', sport: 'Pickleball' },
      { type: 'row', name: 'Lisa Park', rating: '4.0', utr: '7.85', sport: 'Tennis' },
      { type: 'row', name: 'James Wilson', rating: '5.0', utr: '11.20', sport: 'Padel' },
    ],
    stats: ['200+ members', 'UTR auto-import', 'CSV upload'],
  },
  {
    id: 'connect',
    tag: 'CourtConnect',
    tagColor: 'bg-emerald-400/10 text-emerald-400',
    title: 'Fill courts automatically',
    description: 'Create events, set skill ranges, invite matching players. Auto-close with waitlists.',
    icon: Users,
    iconColor: 'text-emerald-400',
    iconBg: 'bg-emerald-400/10',
    mockup: [
      { type: 'event', title: 'Saturday Doubles', sport: 'Tennis', players: '4/4', status: 'Full' },
      { type: 'event', title: 'Beginner Clinic', sport: 'Pickleball', players: '6/12', status: 'Open' },
      { type: 'event', title: 'Competitive Singles', sport: 'Tennis', players: '2/2', status: 'Full' },
    ],
    stats: ['Auto-close', 'Waitlists', 'Email invites'],
  },
  {
    id: 'mixer',
    tag: 'MixerMode',
    tagColor: 'bg-orange-400/10 text-orange-400',
    title: 'One click to round robin',
    description: 'Turn any CourtConnect event into a full round robin. Players pre-loaded, courts assigned.',
    icon: Shuffle,
    iconColor: 'text-orange-400',
    iconBg: 'bg-orange-400/10',
    mockup: [
      { type: 'match', court: '1', team1: 'Sarah & Mike', team2: 'Lisa & James', score: '6-4' },
      { type: 'match', court: '2', team1: 'Anna & Tom', team2: 'Chris & Kim', score: '7-5' },
      { type: 'match', court: '3', team1: 'Pat & Sam', team2: 'Alex & Jo', score: '4-6' },
    ],
    stats: ['Auto-pairing', 'Live scores', 'Standings'],
  },
  {
    id: 'lessons',
    tag: 'LastMinuteLesson',
    tagColor: 'bg-blue-400/10 text-blue-400',
    title: 'Fill open lesson slots instantly',
    description: 'Coaches post openings, blast clients by email, players book in one tap.',
    icon: Clock,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-400/10',
    mockup: [
      { type: 'slot', time: 'Mon 9:00 AM', status: 'Booked', client: 'Sarah J.' },
      { type: 'slot', time: 'Mon 10:30 AM', status: 'Open', client: '' },
      { type: 'slot', time: 'Tue 2:00 PM', status: 'Open', client: '' },
      { type: 'slot', time: 'Wed 4:00 PM', status: 'Booked', client: 'Mike C.' },
    ],
    stats: ['Email blasts', 'One-tap booking', 'Calendar sync'],
  },
  {
    id: 'stringing',
    tag: 'StringingMode',
    tagColor: 'bg-pink-400/10 text-pink-400',
    title: 'Track every racquet, every string',
    description: 'Job tracking from drop-off to pickup. AI recommends the perfect string for each player.',
    icon: Wrench,
    iconColor: 'text-pink-400',
    iconBg: 'bg-pink-400/10',
    mockup: [
      { type: 'job', racquet: 'Wilson Blade 98', string: 'Luxilon ALU Power', status: 'Done', tension: '52/50' },
      { type: 'job', racquet: 'Babolat Pure Aero', string: 'RPM Blast', status: 'In Progress', tension: '55/53' },
      { type: 'job', racquet: 'Head Speed MP', string: 'Hawk Touch', status: 'Pending', tension: '50/48' },
    ],
    stats: ['AI recommendations', 'Job tracking', 'Pickup alerts'],
  },
];

export default function ProductShowcase() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  useEffect(() => {
    if (!isAutoPlaying) return;
    const interval = setInterval(() => {
      setActiveIndex(prev => (prev + 1) % FEATURES.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [isAutoPlaying]);

  const active = FEATURES[activeIndex];
  const Icon = active.icon;

  const handleSelect = (idx: number) => {
    setActiveIndex(idx);
    setIsAutoPlaying(false);
    // Resume auto-play after 15s of inactivity
    setTimeout(() => setIsAutoPlaying(true), 15000);
  };

  return (
    <section className="py-20 px-6 bg-[#002838]">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-sm font-semibold text-[#D3FB52] uppercase tracking-widest mb-3">See It In Action</h2>
          <p className="text-3xl md:text-4xl font-bold tracking-tight text-white">Everything your club needs</p>
        </div>

        {/* Tab Navigation */}
        <div className="flex justify-center gap-2 mb-10 flex-wrap">
          {FEATURES.map((feature, idx) => {
            const TabIcon = feature.icon;
            return (
              <button
                key={feature.id}
                onClick={() => handleSelect(idx)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  idx === activeIndex
                    ? 'bg-white/10 text-white border border-white/20'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                <TabIcon size={16} />
                <span className="hidden sm:inline">{feature.tag}</span>
              </button>
            );
          })}
        </div>

        {/* Feature Display */}
        <div className="grid md:grid-cols-2 gap-8 items-center">
          {/* Left: Info */}
          <div key={active.id} className="animate-fadeSlide">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold mb-4 ${active.tagColor}`}>
              <Icon size={14} />
              {active.tag}
            </span>
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-3 tracking-tight">
              {active.title}
            </h3>
            <p className="text-white/50 text-lg mb-6 leading-relaxed">
              {active.description}
            </p>
            <div className="flex flex-wrap gap-3">
              {active.stats.map(stat => (
                <span key={stat} className="flex items-center gap-1.5 text-sm text-white/60">
                  <Check size={14} className="text-[#D3FB52]" />
                  {stat}
                </span>
              ))}
            </div>
          </div>

          {/* Right: Mockup */}
          <div key={`mockup-${active.id}`} className="animate-fadeSlide">
            <div className="bg-[#001820] border border-white/[0.08] rounded-2xl p-1 shadow-2xl">
              {/* Window chrome */}
              <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/[0.06]">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/60" />
                <div className="w-2.5 h-2.5 rounded-full bg-green-400/60" />
                <div className="flex-1 mx-4">
                  <div className="bg-white/5 rounded-md px-3 py-1 text-xs text-white/30 text-center max-w-xs mx-auto">
                    club.coachmode.ai
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="p-5 space-y-2.5">
                {active.id === 'vault' && active.mockup.map((row: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]" style={{ animationDelay: `${i * 100}ms` }}>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-[#D3FB52]/10 flex items-center justify-center">
                        <span className="text-[#D3FB52] text-xs font-bold">{row.name.charAt(0)}</span>
                      </div>
                      <div>
                        <p className="text-white text-sm font-medium">{row.name}</p>
                        <p className="text-white/30 text-xs">{row.sport}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="px-2 py-0.5 bg-emerald-400/10 text-emerald-400 rounded text-xs">NTRP {row.rating}</span>
                      <span className="px-2 py-0.5 bg-blue-400/10 text-blue-400 rounded text-xs">UTR {row.utr}</span>
                    </div>
                  </div>
                ))}

                {active.id === 'connect' && active.mockup.map((event: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                    <div>
                      <p className="text-white text-sm font-medium">{event.title}</p>
                      <p className="text-white/30 text-xs">{event.sport} &middot; {event.players} players</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      event.status === 'Full' ? 'bg-red-400/10 text-red-400' : 'bg-emerald-400/10 text-emerald-400'
                    }`}>{event.status}</span>
                  </div>
                ))}

                {active.id === 'mixer' && active.mockup.map((match: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-white/30 w-12">Court {match.court}</span>
                      <span className="text-white text-sm">{match.team1}</span>
                      <span className="text-white/30 text-xs">vs</span>
                      <span className="text-white text-sm">{match.team2}</span>
                    </div>
                    <span className="text-[#D3FB52] text-sm font-bold font-mono">{match.score}</span>
                  </div>
                ))}

                {active.id === 'lessons' && active.mockup.map((slot: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                    <div className="flex items-center gap-3">
                      <Clock size={14} className="text-blue-400" />
                      <span className="text-white text-sm">{slot.time}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {slot.client && <span className="text-white/50 text-xs">{slot.client}</span>}
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        slot.status === 'Booked' ? 'bg-blue-400/10 text-blue-400' : 'bg-emerald-400/10 text-emerald-400'
                      }`}>{slot.status}</span>
                    </div>
                  </div>
                ))}

                {active.id === 'stringing' && active.mockup.map((job: any, i: number) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-white/[0.03] rounded-lg border border-white/[0.06]">
                    <div>
                      <p className="text-white text-sm font-medium">{job.racquet}</p>
                      <p className="text-white/30 text-xs">{job.string} &middot; {job.tension} lbs</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      job.status === 'Done' ? 'bg-emerald-400/10 text-emerald-400'
                        : job.status === 'In Progress' ? 'bg-orange-400/10 text-orange-400'
                        : 'bg-white/10 text-white/50'
                    }`}>{job.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Progress indicators */}
        <div className="flex justify-center gap-2 mt-8">
          {FEATURES.map((_, idx) => (
            <button
              key={idx}
              onClick={() => handleSelect(idx)}
              className="relative h-1.5 rounded-full overflow-hidden transition-all"
              style={{ width: idx === activeIndex ? 40 : 16 }}
            >
              <div className="absolute inset-0 bg-white/10 rounded-full" />
              {idx === activeIndex && (
                <div
                  className="absolute inset-0 bg-[#D3FB52] rounded-full"
                  style={{
                    animation: isAutoPlaying ? 'progressFill 5s linear' : 'none',
                    width: isAutoPlaying ? undefined : '100%',
                  }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <style jsx>{`
        @keyframes progressFill {
          from { width: 0%; }
          to { width: 100%; }
        }
        .animate-fadeSlide {
          animation: fadeSlide 0.4s ease-out;
        }
        @keyframes fadeSlide {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}

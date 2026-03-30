'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { MapPin, Globe, Phone, Mail, Calendar, Users, Clock, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Club = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  cover_image_url: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  sports: string[];
  accept_join_requests: boolean;
};

type PublicEvent = {
  id: string;
  title: string;
  event_type: string;
  sport: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  location: string | null;
  max_players: number;
  accepted_count: number;
};

export default function PublicClubPage() {
  const params = useParams();
  const slug = params.slug as string;

  const [club, setClub] = useState<Club | null>(null);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchClub();
  }, [slug]);

  const fetchClub = async () => {
    const supabase = createClient();

    const { data: clubData } = await supabase
      .from('cc_clubs')
      .select('*')
      .eq('slug', slug)
      .eq('is_public', true)
      .single();

    if (clubData) {
      setClub(clubData);

      // Fetch upcoming public events for this club's owner
      const { data: eventsData } = await supabase
        .from('cc_events')
        .select('*')
        .eq('created_by', clubData.owner_id)
        .eq('is_public', true)
        .eq('status', 'open')
        .gte('event_date', new Date().toISOString().split('T')[0])
        .order('event_date', { ascending: true })
        .limit(6);

      if (eventsData) {
        const withCounts = await Promise.all(
          eventsData.map(async (event) => {
            const { count } = await supabase
              .from('cc_event_players')
              .select('*', { count: 'exact', head: true })
              .eq('event_id', event.id)
              .eq('status', 'accepted');
            return { ...event, accepted_count: count || 0 };
          })
        );
        setEvents(withCounts);
      }
    }

    setLoading(false);
  };

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const typeLabel = (type: string) =>
    type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  if (loading) {
    return (
      <div className="min-h-screen bg-[#001820] flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  if (!club) {
    return (
      <div className="min-h-screen bg-[#001820] flex items-center justify-center text-white">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">Club not found</h1>
          <p className="text-white/50 mb-6">This club page doesn&apos;t exist or isn&apos;t public.</p>
          <Link href="/" className="btn bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035]">
            Go to ClubMode
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-[#002838]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#D3FB52] rounded-lg flex items-center justify-center">
              <Zap size={16} className="text-[#002838]" />
            </div>
            <span className="font-bold text-sm text-white/60">ClubMode AI</span>
          </Link>
          <Link href="/login" className="btn btn-sm bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] font-semibold">
            Sign In
          </Link>
        </div>
      </header>

      {/* Club Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[#002838] to-[#001820]" />
        {club.cover_image_url && (
          <div className="absolute inset-0 opacity-20 bg-cover bg-center" style={{ backgroundImage: `url(${club.cover_image_url})` }} />
        )}
        <div className="relative max-w-5xl mx-auto px-6 py-16">
          <div className="flex items-start gap-6">
            {club.logo_url ? (
              <img src={club.logo_url} alt={club.name} className="w-20 h-20 rounded-2xl object-cover border-2 border-white/10" />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-[#D3FB52]/10 border border-[#D3FB52]/20 flex items-center justify-center">
                <span className="text-[#D3FB52] font-bold text-2xl">{club.name.charAt(0)}</span>
              </div>
            )}
            <div className="flex-1">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">{club.name}</h1>
              {club.description && (
                <p className="text-white/60 text-lg max-w-2xl">{club.description}</p>
              )}
              <div className="flex flex-wrap gap-2 mt-4">
                {club.sports?.map(sport => (
                  <span key={sport} className="px-3 py-1 bg-[#D3FB52]/10 text-[#D3FB52] rounded-full text-sm font-medium">
                    {sportLabel(sport)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid md:grid-cols-3 gap-8">
          {/* Main Content */}
          <div className="md:col-span-2 space-y-8">
            {/* Upcoming Events */}
            <div>
              <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                <Calendar size={20} className="text-[#D3FB52]" />
                Upcoming Events
              </h2>
              {events.length === 0 ? (
                <div className="card p-8 text-center">
                  <Calendar size={32} className="mx-auto text-white/20 mb-3" />
                  <p className="text-white/40">No upcoming events right now.</p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {events.map(event => (
                    <Link
                      key={event.id}
                      href={`/courtconnect/events/${event.id}`}
                      className="card card-interactive p-5"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-semibold text-white">{event.title}</h3>
                        <span className="text-xs px-2 py-0.5 bg-emerald-400/10 text-emerald-400 rounded-full">
                          {sportLabel(event.sport)}
                        </span>
                      </div>
                      <div className="space-y-1 text-sm text-white/50">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} />
                          {format(new Date(event.event_date), 'EEE, MMM d')} at {event.start_time.slice(0, 5)}
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-2">
                            <MapPin size={13} />
                            {event.location}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Users size={13} />
                          {typeLabel(event.event_type)} &middot; {event.accepted_count}/{event.max_players}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Contact Info */}
            <div className="card p-5">
              <h3 className="font-semibold text-white mb-4">Contact</h3>
              <div className="space-y-3 text-sm">
                {(club.address || club.city) && (
                  <div className="flex items-start gap-2 text-white/60">
                    <MapPin size={16} className="mt-0.5 shrink-0" />
                    <span>{[club.address, club.city, club.state, club.zip].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {club.phone && (
                  <div className="flex items-center gap-2 text-white/60">
                    <Phone size={16} className="shrink-0" />
                    <span>{club.phone}</span>
                  </div>
                )}
                {club.email && (
                  <div className="flex items-center gap-2 text-white/60">
                    <Mail size={16} className="shrink-0" />
                    <span>{club.email}</span>
                  </div>
                )}
                {club.website && (
                  <div className="flex items-center gap-2 text-white/60">
                    <Globe size={16} className="shrink-0" />
                    <a href={club.website} target="_blank" rel="noopener noreferrer" className="text-[#D3FB52] hover:underline">
                      {club.website.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
              </div>
            </div>

            {/* Join CTA */}
            {club.accept_join_requests && (
              <div className="card p-5 border-[#D3FB52]/20">
                <h3 className="font-semibold text-white mb-2">Join this club</h3>
                <p className="text-white/40 text-sm mb-4">Create a free account to join events and connect with players.</p>
                <Link href="/login" className="btn bg-[#D3FB52] text-[#002838] hover:bg-[#c5f035] w-full font-semibold">
                  Sign Up Free
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 px-6 mt-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-white/30">
          <span>Powered by <a href="/" className="text-[#D3FB52] hover:underline">ClubMode AI</a></span>
          <span>&copy; {new Date().getFullYear()} {club.name}</span>
        </div>
      </footer>
    </div>
  );
}

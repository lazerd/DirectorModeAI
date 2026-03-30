'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Calendar, MapPin, Users, Clock, Mail, UserPlus, CheckCircle, XCircle, Clock3, Send, X, MessageSquare, Shuffle, Flag } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { format } from 'date-fns';

type Event = {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  sport: string;
  event_date: string;
  start_time: string;
  end_time: string | null;
  location: string | null;
  max_players: number;
  auto_close: boolean;
  skill_min: number | null;
  skill_max: number | null;
  is_public: boolean;
  status: string;
  created_by: string;
};

type EventPlayer = {
  id: string;
  player_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  status: string;
  response_order: number | null;
  responded_at: string | null;
  player?: {
    display_name: string;
    primary_sport: string;
  };
};

type AvailablePlayer = {
  id: string;
  display_name: string;
  ntrp_rating: number | null;
  already_invited: boolean;
};

export default function EventDetailPage() {
  const params = useParams();
  const router = useRouter();
  const eventId = params.id as string;

  const [event, setEvent] = useState<Event | null>(null);
  const [players, setPlayers] = useState<EventPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [myRsvpStatus, setMyRsvpStatus] = useState<string | null>(null);
  const [rsvpLoading, setRsvpLoading] = useState(false);

  // Invite dialog state
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);
  const [inviteMode, setInviteMode] = useState<'select' | 'skill'>('skill');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ sent: number; failed: number } | null>(null);

  // Message dialog state
  const [showMessageDialog, setShowMessageDialog] = useState(false);
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageResult, setMessageResult] = useState<{ sent: number } | null>(null);

  // Mixer bridge state
  const [creatingMixer, setCreatingMixer] = useState(false);

  useEffect(() => {
    fetchEvent();
  }, [eventId]);

  const fetchEvent = async () => {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      setCurrentUserId(user.id);
      const { data: playerData } = await supabase
        .from('cc_players')
        .select('id')
        .eq('profile_id', user.id)
        .single();
      if (playerData) setMyPlayerId(playerData.id);
    }

    const { data: eventData } = await supabase
      .from('cc_events')
      .select('*')
      .eq('id', eventId)
      .single();
    setEvent(eventData);

    const { data: playersData } = await supabase
      .from('cc_event_players')
      .select('*, player:cc_players(display_name, primary_sport)')
      .eq('event_id', eventId)
      .order('response_order', { ascending: true, nullsFirst: false });

    if (playersData) {
      setPlayers(playersData);
      if (user) {
        const { data: playerData } = await supabase
          .from('cc_players')
          .select('id')
          .eq('profile_id', user.id)
          .single();
        if (playerData) {
          const match = playersData.find(p => p.player_id === playerData.id);
          if (match) setMyRsvpStatus(match.status);
        }
      }
    }

    setLoading(false);
  };

  const handleRsvp = async (action: 'accept' | 'decline') => {
    if (!currentUserId || !myPlayerId) return;
    setRsvpLoading(true);

    const supabase = createClient();
    const acceptedCount = players.filter(p => p.status === 'accepted').length;
    const isFull = event?.auto_close && acceptedCount >= (event?.max_players || 0);

    const newStatus = action === 'decline' ? 'declined'
      : isFull ? 'waitlisted'
      : 'accepted';

    const existing = players.find(p => p.player_id === myPlayerId);

    if (existing) {
      await supabase
        .from('cc_event_players')
        .update({
          status: newStatus,
          responded_at: new Date().toISOString(),
          response_order: newStatus === 'accepted' ? acceptedCount + 1 : null,
        })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('cc_event_players')
        .insert({
          event_id: eventId,
          player_id: myPlayerId,
          status: newStatus,
          responded_at: new Date().toISOString(),
          response_order: newStatus === 'accepted' ? acceptedCount + 1 : null,
        });
    }

    // Get player name for notification
    const { data: myPlayer } = await supabase
      .from('cc_players')
      .select('display_name')
      .eq('id', myPlayerId)
      .single();

    // Notify event creator
    try {
      await fetch('/api/courtconnect/rsvp-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          playerName: myPlayer?.display_name || 'A player',
          rsvpStatus: newStatus,
        }),
      });
    } catch (err) {
      // Don't block RSVP on notification failure
      console.error('Failed to send RSVP notification:', err);
    }

    setMyRsvpStatus(newStatus);
    setRsvpLoading(false);
    fetchEvent();
  };

  const openInviteDialog = async () => {
    setShowInviteDialog(true);
    setInviteResult(null);
    setSelectedPlayerIds([]);

    if (!event) return;

    const supabase = createClient();

    // Get players who play this sport with matching skill
    let query = supabase
      .from('cc_player_sports')
      .select('player_id, ntrp_rating, player:cc_players(id, display_name, profile_id)')
      .eq('sport', event.sport);

    if (event.skill_min) query = query.gte('ntrp_rating', event.skill_min);
    if (event.skill_max) query = query.lte('ntrp_rating', event.skill_max);

    const { data: sportData } = await query;

    if (sportData) {
      const alreadyInvitedIds = new Set(players.map(p => p.player_id));

      const available = sportData
        .filter((s: any) => s.player?.profile_id !== event.created_by)
        .map((s: any) => ({
          id: s.player?.id || s.player_id,
          display_name: s.player?.display_name || 'Unknown',
          ntrp_rating: s.ntrp_rating,
          already_invited: alreadyInvitedIds.has(s.player?.id || s.player_id),
        }));

      setAvailablePlayers(available);
    }
  };

  const handleSendInvites = async () => {
    setInviting(true);
    setInviteResult(null);

    const body: any = { eventId };

    if (inviteMode === 'select' && selectedPlayerIds.length > 0) {
      body.playerIds = selectedPlayerIds;
    } else {
      body.skillFilter = {
        min: event?.skill_min,
        max: event?.skill_max,
      };
    }

    try {
      const res = await fetch('/api/courtconnect/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setInviteResult({ sent: data.sent || 0, failed: data.failed || 0 });
      fetchEvent(); // Refresh player list
    } catch (err) {
      setInviteResult({ sent: 0, failed: 1 });
    }

    setInviting(false);
  };

  const togglePlayerSelection = (playerId: string) => {
    setSelectedPlayerIds(prev =>
      prev.includes(playerId) ? prev.filter(id => id !== playerId) : [...prev, playerId]
    );
  };

  const handleSendMessage = async () => {
    if (!messageBody.trim()) return;
    setSendingMessage(true);
    setMessageResult(null);

    try {
      const res = await fetch('/api/courtconnect/message-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          subject: messageSubject || undefined,
          message: messageBody,
        }),
      });
      const data = await res.json();
      setMessageResult({ sent: data.sent || 0 });
      setMessageBody('');
      setMessageSubject('');
    } catch {
      setMessageResult({ sent: 0 });
    }

    setSendingMessage(false);
  };

  const handleStartMixer = async () => {
    if (!currentUserId) return;
    setCreatingMixer(true);

    try {
      const res = await fetch('/api/courtconnect/create-mixer-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ccEventId: eventId, userId: currentUserId }),
      });
      const data = await res.json();
      if (data.success && data.mixerEventId) {
        router.push(`/mixer/events/${data.mixerEventId}`);
      }
    } catch (err) {
      console.error('Failed to create mixer event:', err);
    }

    setCreatingMixer(false);
  };

  const handleMarkComplete = async () => {
    const supabase = createClient();
    await supabase
      .from('cc_events')
      .update({ status: 'completed' })
      .eq('id', eventId);
    fetchEvent();
  };

  const handleCancelEvent = async () => {
    if (!confirm('Cancel this event? All players will be notified.')) return;
    const supabase = createClient();
    await supabase
      .from('cc_events')
      .update({ status: 'cancelled' })
      .eq('id', eventId);
    fetchEvent();
  };

  const sportLabel = (sport: string) =>
    sport.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const typeLabel = (type: string) =>
    type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const statusIcon = (status: string) => {
    switch (status) {
      case 'accepted': return <CheckCircle size={16} className="text-green-500" />;
      case 'declined': return <XCircle size={16} className="text-red-500" />;
      case 'waitlisted': return <Clock3 size={16} className="text-yellow-500" />;
      default: return <Mail size={16} className="text-gray-400" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="spinner" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className="text-gray-500">Event not found.</p>
        <Link href="/courtconnect/events" className="btn btn-secondary mt-4">
          Back to Event Board
        </Link>
      </div>
    );
  }

  const isCreator = currentUserId === event.created_by;
  const acceptedPlayers = players.filter(p => p.status === 'accepted');
  const waitlistedPlayers = players.filter(p => p.status === 'waitlisted');
  const invitedPlayers = players.filter(p => p.status === 'invited');
  const isFull = acceptedPlayers.length >= event.max_players;

  return (
    <div className="p-6 max-w-3xl mx-auto page-enter">
      <Link
        href="/courtconnect/events"
        className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft size={16} />
        Back to Event Board
      </Link>

      {/* Event Header */}
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-display">{event.title}</h1>
            {event.description && (
              <p className="text-gray-600 mt-2">{event.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="badge badge-courtconnect">{sportLabel(event.sport)}</span>
            <span className={`badge ${event.status === 'open' ? 'badge-success' : 'badge-warning'}`}>
              {event.status}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2 text-gray-600">
            <Calendar size={16} />
            {format(new Date(event.event_date), 'EEEE, MMMM d, yyyy')}
          </div>
          <div className="flex items-center gap-2 text-gray-600">
            <Clock size={16} />
            {event.start_time.slice(0, 5)}
            {event.end_time && ` - ${event.end_time.slice(0, 5)}`}
          </div>
          {event.location && (
            <div className="flex items-center gap-2 text-gray-600">
              <MapPin size={16} />
              {event.location}
            </div>
          )}
          <div className="flex items-center gap-2 text-gray-600">
            <Users size={16} />
            {typeLabel(event.event_type)} &middot; {acceptedPlayers.length}/{event.max_players} players
          </div>
        </div>

        {(event.skill_min || event.skill_max) && (
          <div className="mt-3 text-sm text-gray-500">
            Skill Range: NTRP {event.skill_min || '1.0'} - {event.skill_max || '7.0'}
          </div>
        )}

        {/* Creator actions */}
        {isCreator && (event.status === 'open' || event.status === 'closed') && (
          <div className="mt-6 pt-4 border-t border-white/[0.06]">
            <div className="flex flex-wrap gap-2">
              {event.status === 'open' && (
                <button onClick={openInviteDialog} className="btn btn-courtconnect btn-sm">
                  <Send size={14} /> Invite Players
                </button>
              )}
              {acceptedPlayers.length > 0 && (
                <>
                  <button onClick={() => setShowMessageDialog(true)} className="btn btn-sm bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">
                    <MessageSquare size={14} /> Message Players
                  </button>
                  <button
                    onClick={handleStartMixer}
                    disabled={creatingMixer || acceptedPlayers.length < 2}
                    className="btn btn-sm bg-orange-500/20 text-orange-400 hover:bg-orange-500/30"
                  >
                    <Shuffle size={14} /> {creatingMixer ? 'Creating...' : 'Start Round Robin'}
                  </button>
                </>
              )}
              {event.status === 'open' && (
                <button onClick={handleMarkComplete} className="btn btn-sm bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
                  <Flag size={14} /> Mark Complete
                </button>
              )}
              <button onClick={handleCancelEvent} className="btn btn-ghost btn-sm text-red-400 hover:bg-red-500/10">
                <X size={14} /> Cancel Event
              </button>
            </div>
          </div>
        )}

        {/* Completed/Cancelled status banner */}
        {event.status === 'completed' && isCreator && (
          <div className="mt-6 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
              <CheckCircle size={18} className="text-emerald-400" />
              <span className="text-emerald-400 font-medium text-sm">Event completed</span>
              {acceptedPlayers.length >= 2 && (
                <button
                  onClick={handleStartMixer}
                  disabled={creatingMixer}
                  className="btn btn-sm bg-orange-500/20 text-orange-400 hover:bg-orange-500/30 ml-auto"
                >
                  <Shuffle size={14} /> {creatingMixer ? 'Creating...' : 'Create Round Robin'}
                </button>
              )}
            </div>
          </div>
        )}

        {event.status === 'cancelled' && (
          <div className="mt-6 pt-4 border-t border-white/[0.06]">
            <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <XCircle size={18} className="text-red-400" />
              <span className="text-red-400 font-medium text-sm">Event cancelled</span>
            </div>
          </div>
        )}

        {/* RSVP buttons for non-creators */}
        {!isCreator && myPlayerId && event.status === 'open' && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            {myRsvpStatus === 'accepted' ? (
              <div className="flex items-center justify-between">
                <span className="text-green-600 font-medium flex items-center gap-2">
                  <CheckCircle size={18} /> You&apos;re in!
                </span>
                <button
                  onClick={() => handleRsvp('decline')}
                  className="btn btn-ghost btn-sm text-red-500"
                  disabled={rsvpLoading}
                >
                  Cancel RSVP
                </button>
              </div>
            ) : myRsvpStatus === 'waitlisted' ? (
              <div className="flex items-center justify-between">
                <span className="text-yellow-600 font-medium flex items-center gap-2">
                  <Clock3 size={18} /> You&apos;re on the waitlist
                </span>
                <button
                  onClick={() => handleRsvp('decline')}
                  className="btn btn-ghost btn-sm text-red-500"
                  disabled={rsvpLoading}
                >
                  Leave Waitlist
                </button>
              </div>
            ) : myRsvpStatus === 'declined' ? (
              <div className="flex items-center justify-between">
                <span className="text-gray-500">You declined this event.</span>
                <button
                  onClick={() => handleRsvp('accept')}
                  className="btn btn-courtconnect btn-sm"
                  disabled={rsvpLoading}
                >
                  Change to Accept
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleRsvp('accept')}
                  className="btn btn-courtconnect flex-1"
                  disabled={rsvpLoading}
                >
                  {rsvpLoading ? <div className="spinner" /> : isFull ? 'Join Waitlist' : 'Accept & Join'}
                </button>
                <button
                  onClick={() => handleRsvp('decline')}
                  className="btn btn-ghost"
                  disabled={rsvpLoading}
                >
                  Decline
                </button>
              </div>
            )}
          </div>
        )}

        {!myPlayerId && currentUserId && !isCreator && (
          <div className="mt-6 pt-4 border-t border-gray-200">
            <p className="text-sm text-gray-500 mb-2">Create a player profile to RSVP to events.</p>
            <Link href="/courtconnect/profile" className="btn btn-courtconnect btn-sm">
              Set Up Profile
            </Link>
          </div>
        )}
      </div>

      {/* Players List */}
      <div className="card p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Users size={20} />
          Players ({acceptedPlayers.length}/{event.max_players})
        </h2>

        {/* Accepted */}
        {acceptedPlayers.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Confirmed</h3>
            <div className="space-y-2">
              {acceptedPlayers.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                  {statusIcon(p.status)}
                  <span className="font-medium">
                    {p.player?.display_name || p.guest_name || 'Unknown'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Waitlisted */}
        {waitlistedPlayers.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-medium text-gray-500 mb-2">Waitlist</h3>
            <div className="space-y-2">
              {waitlistedPlayers.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                  {statusIcon(p.status)}
                  <span className="font-medium text-gray-600">
                    {p.player?.display_name || p.guest_name || 'Unknown'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Invites */}
        {invitedPlayers.length > 0 && isCreator && (
          <div>
            <h3 className="text-sm font-medium text-gray-500 mb-2">Pending Invites</h3>
            <div className="space-y-2">
              {invitedPlayers.map(p => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                  {statusIcon(p.status)}
                  <span className="font-medium text-gray-400">
                    {p.player?.display_name || p.guest_email || 'Unknown'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {players.length === 0 && (
          <p className="text-gray-400 text-sm">No players have joined yet.</p>
        )}
      </div>

      {/* Invite Dialog */}
      {showInviteDialog && (
        <div className="modal-overlay" onClick={() => setShowInviteDialog(false)}>
          <div className="modal w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Invite Players</h2>
              <button onClick={() => setShowInviteDialog(false)} className="btn btn-ghost btn-icon btn-sm">
                <X size={18} />
              </button>
            </div>

            {/* Mode toggle */}
            <div className="tabs mb-4">
              <button
                className={`tab ${inviteMode === 'skill' ? 'tab-active' : ''}`}
                onClick={() => setInviteMode('skill')}
              >
                By Skill Match
              </button>
              <button
                className={`tab ${inviteMode === 'select' ? 'tab-active' : ''}`}
                onClick={() => setInviteMode('select')}
              >
                Select Players
              </button>
            </div>

            {inviteMode === 'skill' ? (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-3">
                  Send invites to all {sportLabel(event.sport)} players
                  {(event.skill_min || event.skill_max) && (
                    <> with NTRP {event.skill_min || '1.0'} - {event.skill_max || '7.0'}</>
                  )}
                  {' '}who haven&apos;t been invited yet.
                </p>
                <p className="text-xs text-gray-400">
                  {availablePlayers.filter(p => !p.already_invited).length} matching players found
                </p>
              </div>
            ) : (
              <div className="mb-4 max-h-64 overflow-y-auto">
                {availablePlayers.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">No matching players found.</p>
                ) : (
                  <div className="space-y-1">
                    {availablePlayers.map(p => (
                      <label
                        key={p.id}
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-50 ${
                          p.already_invited ? 'opacity-50' : ''
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlayerIds.includes(p.id)}
                          onChange={() => togglePlayerSelection(p.id)}
                          disabled={p.already_invited}
                          className="w-4 h-4 rounded border-gray-300 text-courtconnect focus:ring-courtconnect"
                        />
                        <span className="font-medium text-sm">{p.display_name}</span>
                        {p.ntrp_rating && (
                          <span className="badge badge-courtconnect text-xs">NTRP {p.ntrp_rating}</span>
                        )}
                        {p.already_invited && (
                          <span className="text-xs text-gray-400 ml-auto">Already invited</span>
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Result message */}
            {inviteResult && (
              <div className={`alert ${inviteResult.sent > 0 ? 'alert-success' : 'alert-warning'} mb-4`}>
                <p className="text-sm">
                  {inviteResult.sent > 0
                    ? `Sent ${inviteResult.sent} invite${inviteResult.sent !== 1 ? 's' : ''} successfully!`
                    : 'No invites sent. All matching players may already be invited.'}
                  {inviteResult.failed > 0 && ` (${inviteResult.failed} failed)`}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSendInvites}
                className="btn btn-courtconnect flex-1"
                disabled={inviting || (inviteMode === 'select' && selectedPlayerIds.length === 0)}
              >
                {inviting ? <div className="spinner" /> : (
                  <>
                    <Send size={16} />
                    {inviteMode === 'skill'
                      ? 'Invite All Matching Players'
                      : `Invite ${selectedPlayerIds.length} Player${selectedPlayerIds.length !== 1 ? 's' : ''}`}
                  </>
                )}
              </button>
              <button
                onClick={() => setShowInviteDialog(false)}
                className="btn btn-ghost"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Players Dialog */}
      {showMessageDialog && (
        <div className="modal-overlay" onClick={() => setShowMessageDialog(false)}>
          <div className="modal w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Message Confirmed Players</h2>
              <button onClick={() => setShowMessageDialog(false)} className="p-1.5 hover:bg-white/10 rounded-lg">
                <X size={18} className="text-white/60" />
              </button>
            </div>

            <p className="text-sm text-white/50 mb-4">
              Send a message to all {acceptedPlayers.length} confirmed player{acceptedPlayers.length !== 1 ? 's' : ''}.
            </p>

            <div className="space-y-3 mb-4">
              <div>
                <label className="label text-white/70 text-sm">Subject (optional)</label>
                <input
                  type="text"
                  className="input"
                  placeholder={`About: ${event.title}`}
                  value={messageSubject}
                  onChange={e => setMessageSubject(e.target.value)}
                />
              </div>
              <div>
                <label className="label text-white/70 text-sm">Message *</label>
                <textarea
                  className="input"
                  rows={4}
                  placeholder="Type your message to all confirmed players..."
                  value={messageBody}
                  onChange={e => setMessageBody(e.target.value)}
                />
              </div>
            </div>

            {messageResult && (
              <div className="alert alert-success mb-4">
                <p className="text-sm">Message sent to {messageResult.sent} player{messageResult.sent !== 1 ? 's' : ''}!</p>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={handleSendMessage}
                className="btn btn-courtconnect flex-1"
                disabled={sendingMessage || !messageBody.trim()}
              >
                {sendingMessage ? <div className="spinner" /> : (
                  <><MessageSquare size={16} /> Send to {acceptedPlayers.length} Player{acceptedPlayers.length !== 1 ? 's' : ''}</>
                )}
              </button>
              <button onClick={() => setShowMessageDialog(false)} className="btn btn-ghost">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

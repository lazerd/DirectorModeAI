'use client';

import { useEffect, useState } from 'react';
import { Users, Copy, Check, Loader2, Crown, GraduationCap, User as UserIcon } from 'lucide-react';

type Member = { role: string; name: string; email: string | null };

export default function ClubMembersPage() {
  const [loading, setLoading] = useState(true);
  const [club, setClub] = useState<{ name: string; join_code: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/clubs/members');
        const json = await res.json();
        setClub(json.club);
        setMembers(json.members || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const joinUrl = club ? `${typeof window !== 'undefined' ? window.location.origin : 'https://club.coachmode.ai'}/join/${club.join_code}` : '';

  const copy = () => {
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const roleIcon = (r: string) =>
    r === 'owner' || r === 'director' ? <Crown className="h-4 w-4 text-yellow-500" />
    : r === 'coach' ? <GraduationCap className="h-4 w-4 text-violet-500" />
    : <UserIcon className="h-4 w-4 text-gray-400" />;

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-400" /></div>;
  }

  if (!club) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <Users className="h-10 w-10 mx-auto text-gray-300 mb-3" />
        <h1 className="text-xl font-semibold">No club to manage</h1>
        <p className="text-gray-500 mt-1">Only a club owner can manage members. Open a tool like CourtSheet to set up your club.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 md:py-12">
      <div className="flex items-center gap-3 mb-1">
        <Users className="text-blue-600" size={24} />
        <h1 className="font-display text-3xl">Members</h1>
      </div>
      <p className="text-gray-500 mb-8">Invite your members to {club.name}. They log in to book courts, sign up for lessons, and track their progress.</p>

      <div className="rounded-2xl border-2 border-blue-100 bg-blue-50/50 p-5 mb-8">
        <div className="text-sm font-medium text-gray-700 mb-2">Share this invite link</div>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={joinUrl}
            style={{ color: '#111827' }}
            className="flex-1 px-3 py-2 rounded-lg border border-gray-300 bg-white text-sm"
          />
          <button onClick={copy} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium flex items-center gap-2 hover:bg-blue-700">
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
          </button>
        </div>
        <div className="mt-2 text-xs text-gray-500">Or share the code: <span className="font-mono font-semibold text-gray-800">{club.join_code}</span></div>
      </div>

      <div className="rounded-2xl border p-1">
        <div className="px-4 py-3 text-sm font-semibold text-gray-600">{members.length} member{members.length === 1 ? '' : 's'}</div>
        <div className="divide-y">
          {members.map((m, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                {roleIcon(m.role)}
                <div>
                  <div className="text-sm font-medium text-gray-900">{m.name}</div>
                  {m.email && <div className="text-xs text-gray-400">{m.email}</div>}
                </div>
              </div>
              <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-600 capitalize">{m.role}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

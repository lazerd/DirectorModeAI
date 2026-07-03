'use client';

import { useEffect, useState } from 'react';
import { Users, Copy, Check, Loader2, Crown, GraduationCap, User as UserIcon, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';

type Member = { role: string; name: string; email: string | null };
type VaultPlayer = { id: string; full_name: string; email: string };

export default function ClubMembersPage() {
  const [loading, setLoading] = useState(true);
  const [club, setClub] = useState<{ name: string; join_code: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState(false);
  const [vault, setVault] = useState<VaultPlayer[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/clubs/members');
        const json = await res.json();
        setClub(json.club);
        setMembers(json.members || []);
        const vr = await fetch('/api/clubs/invite-vault');
        const vj = await vr.json();
        setVault(vj.players || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const sendInvites = async () => {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const res = await fetch('/api/clubs/invite-vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...selected] }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not send');
      toast.success(`Sent ${json.sent} invite${json.sent === 1 ? '' : 's'}${json.capped ? ' (hit your monthly email limit — upgrade for more)' : ''}.`);
      setSelected(new Set());
    } catch (e: any) {
      toast.error(e?.message || 'Could not send invites.');
    } finally {
      setSending(false);
    }
  };

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

      {vault.length > 0 && (
        <div className="rounded-2xl border p-5 mb-8">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <Mail size={16} className="text-blue-600" /> Invite your roster
            </div>
            <button
              onClick={sendInvites}
              disabled={sending || selected.size === 0}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <><Send size={14} /> Send{selected.size > 0 ? ` (${selected.size})` : ''}</>}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">Email PlayerVault players their invite link so they can join and book courts, lessons, and track progress.</p>
          <div className="max-h-64 overflow-y-auto divide-y border-t">
            <label className="flex items-center gap-2 py-2 text-sm text-gray-500 cursor-pointer">
              <input type="checkbox" checked={selected.size === vault.length && vault.length > 0} onChange={(e) => setSelected(e.target.checked ? new Set(vault.map((v) => v.id)) : new Set())} className="h-4 w-4" />
              Select all ({vault.length})
            </label>
            {vault.map((v) => (
              <label key={v.id} className="flex items-center gap-3 py-2 cursor-pointer">
                <input type="checkbox" checked={selected.has(v.id)} onChange={() => toggle(v.id)} className="h-4 w-4" />
                <div><div className="text-sm font-medium text-gray-900">{v.full_name}</div><div className="text-xs text-gray-400">{v.email}</div></div>
              </label>
            ))}
          </div>
        </div>
      )}

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

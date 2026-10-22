import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, EyeOff, Lock, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { normalizeRefCode } from '@/lib/connect/referrals';
import { PRIVACY_PATH } from '@/lib/connect/privacy';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Founding director network · ClubMode Recruiting',
  description: 'A free, confidential network for racquets directors. Your details go only to clubs you choose.',
};

const POINTS = [
  {
    icon: Sparkles,
    title: 'Free, always',
    body: 'Directors never pay. Clubs pay only when they hire someone we introduced.',
  },
  {
    icon: Lock,
    title: 'Your details go only where you say',
    body: 'A club sees your profile and résumé only after you say yes to that club, for that role. Nobody else does.',
  },
  {
    icon: EyeOff,
    title: 'Confidential',
    body: 'We never tell your current employer, and your current pay is never shown to any club.',
  },
  {
    icon: Users,
    title: 'Roles worth a look',
    body: 'We watch director openings across the country and tell you about the ones that beat what you have now, close enough to take.',
  },
];

// Public page for directors Darrin invites personally (and for anyone who arrives on a
// candidate's private invite link via /connect/join). Joining = making your own profile.
export default async function FoundingNetworkPage({ searchParams }: { searchParams: { ref?: string } }) {
  const ref = normalizeRefCode(searchParams?.ref);
  const profilePath = `/connect/candidate${ref ? `?ref=${ref}` : ''}`;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const joinHref = user ? profilePath : `/register?next=${encodeURIComponent(profilePath)}`;

  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <Link href="/connect" className="text-sm text-teal-400 underline">ClubMode Recruiting</Link>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">The founding director network</h1>
      <p className="mt-3 text-lg text-slate-300">
        A small, invite-first group of Directors of Tennis and Racquets who want to hear about the right next job, without
        putting their name on a job board.
      </p>
      {ref && (
        <p className="mt-3 inline-block rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-sm text-teal-200">
          A colleague who&apos;s already a member recommended you.
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {POINTS.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-5">
            <Icon className="h-5 w-5 text-teal-400" />
            <h2 className="mt-2 font-semibold text-white">{title}</h2>
            <p className="mt-1 text-sm text-slate-300">{body}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="font-semibold text-white">How it works</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-300">
          <li>Make your profile: role, experience, where you&apos;d move, the least you&apos;d take. Add a résumé when you&apos;re ready.</li>
          <li>When a director opening fits, we tell you privately. You decide if it&apos;s worth a look.</li>
          <li>Only if you say yes does that one club see your profile and résumé.</li>
          <li>Turn &quot;open to work&quot; off any time, or delete your profile and résumé in one click.</li>
        </ol>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Link
          href={joinHref}
          className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-5 py-3 font-semibold text-white hover:bg-teal-500"
        >
          Join the founding director network <ArrowRight className="h-4 w-4" />
        </Link>
        {!user && (
          <Link href={`/login?redirect=${encodeURIComponent(profilePath)}`} className="text-sm text-teal-400 underline">
            Already have a ClubMode account? Sign in
          </Link>
        )}
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Joining means you make your own profile. Nobody is signed up on your behalf.
      </p>

      <p className="mt-10 flex items-center gap-1.5 text-sm text-slate-400">
        <ShieldCheck className="h-4 w-4" />
        <Link href={PRIVACY_PATH} className="text-teal-400 underline">How we handle your information</Link>
      </p>
    </div>
  );
}

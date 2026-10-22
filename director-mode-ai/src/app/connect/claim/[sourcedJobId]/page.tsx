'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CheckCircle2, Loader2, MapPin, ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

type Data = {
  job: {
    id: string; club_name: string | null; title: string | null; city: string | null; state: string | null;
    comp_max: number | null; comp_posted: boolean; active: boolean; claimed: boolean; opening_id: string | null;
  };
  counts: { interested: number };
  terms: { fee: number; version: string; lines: string[] };
  me: { signedIn: boolean; email: string | null; mine: boolean };
};

const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;

// A club accepts ClubMode's pay-on-hire terms for a job we found on a public board.
// Their opening is created, and the candidates who asked to be put forward land in it.
export default function ClaimJobPage() {
  const { sourcedJobId } = useParams<{ sourcedJobId: string }>();
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [accept, setAccept] = useState(false);
  const [comp, setComp] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState<{ openingId: string; verified: boolean; moved: number } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/connect/claim/${sourcedJobId}`);
    if (res.ok) {
      const d = (await res.json()) as Data;
      setData(d);
      if (d.job.comp_posted && d.job.comp_max) setComp(String(d.job.comp_max));
    }
    setLoading(false);
  }, [sourcedJobId]);
  useEffect(() => {
    load();
  }, [load]);

  async function claim() {
    setMsg('');
    setBusy(true);
    try {
      const res = await fetch(`/api/connect/claim/${sourcedJobId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accept_terms: true, comp_max: comp ? Number(comp.replace(/[^0-9]/g, '')) : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error || 'Could not accept the terms.');
      else setDone(d);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-300"><Loader2 className="h-5 w-5 animate-spin inline" /> Loading…</div>;
  if (!data) return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-200">This link isn&apos;t valid any more.</div>;

  const { job, counts, terms, me } = data;
  const club = job.club_name || 'your club';
  const role = job.title || 'Director of Racquets';
  const place = [job.city, job.state].filter(Boolean).join(', ');
  const here = `/connect/claim/${job.id}`;

  if (done) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Card className="bg-white">
          <CardContent className="pt-6 space-y-3 text-slate-800">
            <div className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-5 w-5" /> You&apos;re set up</div>
            {done.verified ? (
              <p>{done.moved > 0 ? `${done.moved} candidate${done.moved === 1 ? ' is' : 's are'} in your pipeline now, with AI fit notes on the way.` : 'Your opening is live. New candidates appear in your pipeline as they apply.'}</p>
            ) : (
              <p>Your opening is live. Because we couldn&apos;t match your email to {club}, we&apos;ll confirm you speak for the club (usually same day) and then the interested candidates land in your pipeline.</p>
            )}
            <Button onClick={() => router.push(`/connect/clubs/${done.openingId}`)}>Open the pipeline</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      <div className="mb-6">
        <div className="text-slate-300">{club}</div>
        <h1 className="text-3xl font-bold tracking-tight text-white">{role}</h1>
        {place && <div className="mt-1 text-sm text-slate-300"><MapPin className="h-3.5 w-3.5 inline" /> {place}</div>}
      </div>

      {me.mine && job.opening_id ? (
        <Card className="bg-white"><CardContent className="pt-6 text-slate-800">
          <p className="mb-3">You already accepted the terms for this role.</p>
          <Link href={`/connect/clubs/${job.opening_id}`}><Button>Open the pipeline</Button></Link>
        </CardContent></Card>
      ) : !job.active ? (
        <Card className="bg-white"><CardContent className="pt-6 text-slate-800">
          {job.claimed ? 'This role has already been set up by the club.' : 'This role is no longer open.'} Questions? Reply to our email.
        </CardContent></Card>
      ) : (
        <Card className="bg-white">
          <CardHeader>
            <CardTitle className="text-base text-slate-900">
              {counts.interested > 0
                ? `${counts.interested} qualified director${counts.interested === 1 ? ' has' : 's have'} asked to be put forward for this role`
                : 'See candidates for this role'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-slate-800">
            <p className="text-sm">No retainer. You pay a flat <strong>{usd(terms.fee)}</strong> only if you hire someone we introduce.</p>
            <ul className="text-sm list-disc pl-5 space-y-1 text-slate-700">
              {terms.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>

            {!me.signedIn ? (
              <div className="text-sm">
                <p className="mb-3">Sign in or create a free account with your club email to continue.</p>
                <div className="flex gap-2">
                  <Link href={`/login?redirect=${encodeURIComponent(here)}`}><Button>Sign in</Button></Link>
                  <Link href={`/register?next=${encodeURIComponent(here)}`}><Button variant="outline">Create account</Button></Link>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="comp" className="text-sm font-medium block mb-1">Top of the pay range for this role</label>
                  <input
                    id="comp" inputMode="numeric" value={comp} onChange={(e) => setComp(e.target.value)} placeholder="e.g. 150000"
                    className="w-48 rounded-md border border-slate-300 px-3 py-2 text-sm" style={{ color: '#0f172a' }}
                  />
                  <p className="text-xs text-slate-500 mt-1">Only used to match candidates. Never shown publicly without your say-so.</p>
                </div>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                  <span>I accept these terms for {club} (terms version {terms.version}).</span>
                </label>
                <div className="flex items-center gap-3">
                  <Button onClick={claim} disabled={busy || !accept}>
                    {busy ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Setting up…</> : 'Accept and see candidates'}
                  </Button>
                  <span className="text-xs text-slate-500 flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Signed in as {me.email}</span>
                </div>
              </>
            )}
            {msg && <p className="text-sm text-red-700">{msg}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

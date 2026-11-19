import Link from 'next/link';
import { unsubscribeAlert } from '@/lib/play/near';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Alerts stopped', robots: { index: false } };

export default async function AlertsOff({ searchParams }: { searchParams: { t?: string } }) {
  const r = searchParams.t ? await unsubscribeAlert(searchParams.t) : null;
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center" style={{ color: '#103c32' }}>
      <h1 className="text-[30px] font-semibold tracking-tight">{r ? 'Done. No more alerts.' : 'Already stopped.'}</h1>
      <p className="mt-3 text-[16px]" style={{ color: '#6a7b71' }}>{r ? `You won’t get “need one” emails for ${r.sport} at ${r.email} anymore.` : 'That link has already been used, or the alert was removed.'}</p>
      <Link href="/play/near" className="mt-8 inline-block rounded-2xl px-5 py-3 font-semibold" style={{ background: '#d4ff49' }}>Find a game near me</Link>
    </main>
  );
}

import Link from 'next/link';
import { unsubscribe } from '@/lib/play/groupsServer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Unsubscribed', robots: { index: false } };

/**
 * One-click unsubscribe from a Racquets IRL group email. Opening the link is the
 * unsubscribe (that group, or the host if the link was host-wide); the buttons widen it.
 */
export default async function PlayUnsubscribe({ searchParams }: { searchParams: { t?: string; done?: string } }) {
  const t = searchParams.t ?? '';
  const done = searchParams.done;
  const r = done === 'bad' ? null : await unsubscribe(t, 'token');
  const ink = '#103c32', muted = '#6a7b71';
  const head = !r ? 'That link didn’t work.'
    : done === 'all' ? 'Done. No more game emails from anyone on Racquets IRL.'
      : done === 'host' || r.hostScope ? 'Done. No more game emails from this host.'
        : `Done. You’re off ${r.groupName ? `“${r.groupName}”` : 'that group'}.`;
  return (
    <main className="mx-auto max-w-md px-6 py-20 text-center" style={{ color: ink }}>
      <h1 className="text-[28px] font-semibold tracking-tight">{head}</h1>
      <p className="mt-3 text-[16px]" style={{ color: muted }}>
        {r ? `We won’t email ${r.email} about these again. This holds even if you’re added back to a group.` : 'It may be cut off or very old. Reply to the email and ask the host to take you off.'}
      </p>
      {r && done !== 'all' && (
        <div className="mt-8 grid gap-2">
          {!r.hostScope && done !== 'host' && (
            <form method="post" action="/api/p/groups/unsubscribe">
              <input type="hidden" name="t" value={t} /><input type="hidden" name="scope" value="host" />
              <button className="w-full rounded-2xl px-5 py-3 font-semibold" style={{ background: '#eef1e8' }}>Stop all games from this host</button>
            </form>
          )}
          <form method="post" action="/api/p/groups/unsubscribe">
            <input type="hidden" name="t" value={t} /><input type="hidden" name="scope" value="all" />
            <button className="w-full rounded-2xl px-5 py-3 font-semibold" style={{ background: '#eef1e8' }}>Stop game emails from every host</button>
          </form>
        </div>
      )}
      <Link href="/play/near" className="mt-8 inline-block rounded-2xl px-5 py-3 font-semibold" style={{ background: '#d4ff49' }}>Find a game near me</Link>
    </main>
  );
}

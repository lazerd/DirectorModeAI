import type { Metadata } from 'next';
import Link from 'next/link';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { crownFor, placeSlug, CROWN_DAYS } from '@/lib/play/crown';

export const dynamic = 'force-dynamic';

async function placeName(slug: string) {
  const { data } = await getSupabaseAdmin().from('play_events').select('location').not('location', 'is', null).order('updated_at', { ascending: false }).limit(1000);
  return (data ?? []).find((e) => placeSlug(e.location) === slug)?.location ?? null;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const place = await placeName(params.slug);
  const c = place ? await crownFor(place) : null;
  const t = place ? `King of the Court · ${place}` : 'King of the Court';
  const d = c?.king ? `👑 ${c.king.name} holds the crown with ${c.king.wins} wins in ${CROWN_DAYS} days. Come take it.` : 'The crown is open. Win a game here and it’s yours.';
  return { title: t, description: d, openGraph: { title: t, description: d } };
}

export default async function CourtCrownPage({ params }: { params: { slug: string } }) {
  const place = await placeName(params.slug);
  const c = place ? await crownFor(place) : null;
  const ink = '#103c32', lime = '#d4ff49';
  return (
    <main className="min-h-screen pb-20" style={{ background: '#f4f5ef', color: ink }}>
      <div className="mx-auto max-w-xl px-5 pt-8">
        <Link href="/play/new" className="text-[14px] font-semibold">Racquets IRL</Link>
        <section className="mt-6 rounded-3xl p-6 text-center text-white shadow-lg" style={{ background: ink }}>
          <div className="text-[54px] leading-none">👑</div>
          <div className="mt-2 text-[12px] font-semibold uppercase tracking-[2px]" style={{ color: '#bccdbb' }}>King of the Court</div>
          <h1 className="mt-1 text-[30px] font-medium tracking-tight">{place ?? 'Unknown courts'}</h1>
          {c?.king ? (
            <div className="mt-5 rounded-2xl p-4" style={{ background: lime, color: ink }}>
              <div className="text-[36px] font-semibold leading-tight">{c.king.name}</div>
              <div className="text-[15px]">{c.king.wins} wins · {c.king.gamesFor}–{c.king.gamesAgainst} games · last {CROWN_DAYS} days</div>
            </div>
          ) : (
            <p className="mt-5 text-[16px]" style={{ color: '#dfe8dc' }}>Nobody holds the crown here yet. Play a game here and it&apos;s up for grabs.</p>
          )}
          {c?.queen && (
            <div className="mt-3 rounded-2xl bg-white/10 p-3 text-[16px]">Queen of the Court: <b>{c.queen.name}</b> · {c.queen.wins} wins</div>
          )}
        </section>
        {c && c.ladder.length > 0 && (
          <section className="mt-4 rounded-3xl bg-white p-4 shadow-sm">
            <div className="mb-2 px-1 text-[16px] font-semibold">The ladder · {c.events} event{c.events === 1 ? '' : 's'}</div>
            <table className="w-full text-[15px]"><tbody>
              {c.ladder.slice(0, 25).map((r, i) => (
                <tr key={r.key} className="border-t" style={{ borderColor: '#eef1e8' }}>
                  <td className="py-2 pl-1">{i === 0 ? '👑' : i + 1}</td><td>{r.name}</td><td className="text-right">{r.wins}–{r.losses}</td><td className="pr-1 text-right" style={{ color: '#6a7b71' }}>{r.gamesFor}–{r.gamesAgainst}</td>
                </tr>
              ))}
            </tbody></table>
          </section>
        )}
        <Link href={`/play/new?q=${encodeURIComponent(`Doubles at ${place ?? ''}`)}`} className="mt-5 flex h-14 items-center justify-center rounded-2xl text-[17px] font-semibold" style={{ background: lime, color: ink }}>
          Start a game here and go for the crown
        </Link>
        <p className="mt-3 text-center text-[13px]" style={{ color: '#6a7b71' }}>Every Racquets IRL game played here counts. Most wins in the last {CROWN_DAYS} days holds the crown.</p>
      </div>
    </main>
  );
}

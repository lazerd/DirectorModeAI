import Link from 'next/link';
import { Trophy, ClipboardList, PencilLine, GitBranch, MapPin, QrCode } from 'lucide-react';
import { isCompassFormat } from '@/lib/compassLayout';
import { HubEvent, HUB_FORMAT_LABELS, hubSortKey, hubParseName } from './hubShared';

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  running: 'bg-blue-400/15 text-blue-300 border-blue-400/30',
  completed: 'bg-white/10 text-white/60 border-white/20',
};

/**
 * The shared hub page body — a dark, mobile-first page listing every tournament
 * in a hub with Standings / Enter Scores / Draw links, plus a "Print QR posters"
 * action. Compass draws hide the Standings button (placement comes from the
 * draw). Presentational only; the route fetches + passes the events.
 */
export default function HubView({
  title,
  eyebrow,
  events,
  postersHref,
}: {
  title: string;
  eyebrow?: string;
  events: HubEvent[];
  postersHref: string;
}) {
  const sorted = events
    .filter((e) => !!e.slug)
    .sort((a, b) => hubSortKey(a.name) - hubSortKey(b.name) || a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-8 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={26} className="text-[#002838]" />
          </div>
          <div className="min-w-0">
            {eyebrow && (
              <div className="text-xs uppercase tracking-widest text-[#D3FB52]/80 font-bold">{eyebrow}</div>
            )}
            <h1 className="text-2xl font-bold leading-tight">{title}</h1>
            <div className="text-sm text-white/50">Tap any division to view standings, enter scores, or open the draw</div>
          </div>
        </div>
        {sorted.length > 0 && (
          <div className="max-w-3xl mx-auto px-4 pb-6 -mt-2">
            <Link
              href={postersHref}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#D3FB52] text-[#00131c] text-sm font-bold hover:brightness-95 transition-all"
            >
              <QrCode size={16} />
              Print QR posters
            </Link>
          </div>
        )}
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {sorted.length === 0 ? (
          <div className="bg-white/5 rounded-2xl p-10 text-center text-white/60">
            No draws are live in this hub yet — check back closer to match day.
          </div>
        ) : (
          <div className="space-y-4">
            {sorted.map((e) => {
              const { title: cardTitle, venue } = hubParseName(e.name);
              const slug = e.slug as string;
              const compass = isCompassFormat(e.match_format);
              return (
                <div key={e.id} className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold truncate">{cardTitle}</h2>
                      <div className="flex items-center gap-2 text-sm text-white/50 mt-0.5 flex-wrap">
                        <span>{HUB_FORMAT_LABELS[e.match_format || ''] || e.match_format}</span>
                        {venue && (
                          <>
                            <span className="text-white/20">•</span>
                            <span className="inline-flex items-center gap-1">
                              <MapPin size={13} />
                              {venue}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {e.public_status && (
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold border shrink-0 capitalize ${
                          STATUS_STYLES[e.public_status] || STATUS_STYLES.completed
                        }`}
                      >
                        {e.public_status === 'running' ? 'Live' : e.public_status}
                      </span>
                    )}
                  </div>
                  <div className={`grid gap-2 ${compass ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {!compass && (
                      <Link
                        href={`/tournaments/${slug}/results`}
                        className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition-colors text-center"
                      >
                        <Trophy size={18} className="text-[#D3FB52]" />
                        <span className="text-xs font-semibold">Standings</span>
                      </Link>
                    )}
                    <Link
                      href={`/tournaments/${slug}/enter`}
                      className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl bg-[#D3FB52] text-[#00131c] hover:brightness-95 transition-all text-center"
                    >
                      <PencilLine size={18} />
                      <span className="text-xs font-bold">Enter Scores</span>
                    </Link>
                    <Link
                      href={`/tournaments/${slug}/draw`}
                      className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition-colors text-center"
                    >
                      <GitBranch size={18} className="text-white/70" />
                      <span className="text-xs font-semibold">Draw</span>
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-white/30">
          <ClipboardList size={13} />
          Powered by ClubMode
        </div>
      </main>
    </div>
  );
}

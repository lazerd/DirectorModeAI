import Link from 'next/link';
import { Trophy, ClipboardList, PencilLine, GitBranch, MapPin } from 'lucide-react';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Public hub for the JTT Season-End Championships — one page that links into
// every division's Standings / Enter-Scores / Draw pages, so a director or a
// visiting-club coach can reach any draw from a single link.
//
// Scoped to Sleepy Hollow's director so this public URL only ever surfaces our
// season-end draws (the events are matched by the "Season-End" name convention,
// same as the JTT league admin panel). New season-end draws this director
// creates appear here automatically.
const DIRECTOR_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';

const FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin',
  'rr-doubles': 'Round Robin — Doubles',
  'compass-singles': 'Compass Draw',
  'compass-doubles': 'Compass Draw — Doubles',
  'single-elim-singles': 'Single Elimination',
  'single-elim-doubles': 'Single Elimination — Doubles',
  'fmlc-singles': 'First-Match Consolation',
  'ffic-singles': 'Full Feed-In',
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-emerald-400/15 text-emerald-300 border-emerald-400/30',
  running: 'bg-blue-400/15 text-blue-300 border-blue-400/30',
  completed: 'bg-white/10 text-white/60 border-white/20',
};

// Sort so the divisions read youngest → oldest → open.
function sortKey(name: string): number {
  if (/10U/i.test(name)) return name.toLowerCase().includes('silver') ? 12 : 11;
  if (/12U/i.test(name)) return 20;
  if (/13\s*&|13&O|13 ?& ?Over/i.test(name)) return 30;
  if (/open/i.test(name)) return 40;
  return 50;
}

// "JTT 10U Season-End — Gold · Sleepy Hollow" → title "10U — Gold", venue "Sleepy Hollow"
function parseName(name: string): { title: string; venue: string | null } {
  const parts = name.split('·').map((s) => s.trim());
  const venue = parts.length > 1 ? parts[parts.length - 1] : null;
  let title = parts[0]
    .replace(/^JTT\s+/i, '')
    .replace(/\s*Season-End\s*(Tournament)?/i, ' ')
    .replace(/—\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (title.endsWith('—')) title = title.slice(0, -1).trim();
  return { title: title || parts[0], venue };
}

type Ev = {
  id: string;
  name: string;
  slug: string | null;
  match_format: string | null;
  public_status: string | null;
  event_date: string | null;
};

export default async function SeasonEndHubPage() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('events')
    .select('id, name, slug, match_format, public_status, event_date')
    .eq('user_id', DIRECTOR_ID)
    .ilike('name', '%season-end%')
    .in('public_status', ['open', 'running', 'completed'])
    .order('event_date');

  const events = ((data as Ev[]) || [])
    .filter((e) => !!e.slug)
    .sort((a, b) => sortKey(a.name) - sortKey(b.name) || a.name.localeCompare(b.name));

  return (
    <div className="min-h-screen bg-[#001820] text-white">
      <header className="border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-8 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-[#D3FB52] flex items-center justify-center flex-shrink-0">
            <Trophy size={26} className="text-[#002838]" />
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-widest text-[#D3FB52]/80 font-bold">
              Lamorinda Junior Team Tennis
            </div>
            <h1 className="text-2xl font-bold leading-tight">Season-End Championships</h1>
            <div className="text-sm text-white/50">Tap any division to view standings, enter scores, or open the draw</div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {events.length === 0 ? (
          <div className="bg-white/5 rounded-2xl p-10 text-center text-white/60">
            No season-end draws are live yet — check back closer to match day.
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((e) => {
              const { title, venue } = parseName(e.name);
              const slug = e.slug as string;
              return (
                <div key={e.id} className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="min-w-0">
                      <h2 className="text-lg font-bold truncate">{title}</h2>
                      <div className="flex items-center gap-2 text-sm text-white/50 mt-0.5 flex-wrap">
                        <span>{FORMAT_LABELS[e.match_format || ''] || e.match_format}</span>
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
                  <div className="grid grid-cols-3 gap-2">
                    <Link
                      href={`/tournaments/${slug}/results`}
                      className="flex flex-col items-center justify-center gap-1 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] transition-colors text-center"
                    >
                      <Trophy size={18} className="text-[#D3FB52]" />
                      <span className="text-xs font-semibold">Standings</span>
                    </Link>
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

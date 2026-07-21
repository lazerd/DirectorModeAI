import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import DrawView from '@/components/tournament/DrawView';
import PrintBar from './PrintBar';

export const dynamic = 'force-dynamic';

const FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin — Singles',
  'rr-doubles': 'Round Robin — Doubles',
  'single-elim-singles': 'Single Elimination — Singles',
  'single-elim-doubles': 'Single Elimination — Doubles',
  'fmlc-singles': 'First-Match Loser Consolation — Singles',
  'fmlc-doubles': 'First-Match Loser Consolation — Doubles',
  'ffic-singles': 'Full Feed-In Consolation — Singles',
  'ffic-doubles': 'Full Feed-In Consolation — Doubles',
  'compass-singles': 'Compass Draw — Singles',
  'compass-doubles': 'Compass Draw — Doubles',
};

type Entry = {
  id: string;
  player_name: string;
  partner_name: string | null;
  seed: number | null;
};

type Match = {
  id: string;
  bracket: 'main' | 'consolation';
  round: number;
  slot: number;
  player1_id: string | null;
  player3_id: string | null;
  score: string | null;
  winner_side: 'a' | 'b' | null;
  status: string;
  court: string | null;
  scheduled_at: string | null;
};

export default async function PrintDrawPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const admin = getSupabaseAdmin();

  const { data: ev } = await admin
    .from('events')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (!ev || !FORMAT_LABELS[(ev as any).match_format]) return notFound();
  const e = ev as any;

  const [entriesRes, matchesRes] = await Promise.all([
    admin
      .from('tournament_entries')
      .select('id, player_name, partner_name, seed')
      .eq('event_id', e.id),
    admin
      .from('tournament_matches')
      .select('id, bracket, round, slot, player1_id, player3_id, score, winner_side, status, court, scheduled_at')
      .eq('event_id', e.id)
      .order('round')
      .order('slot'),
  ]);

  const entries = (entriesRes.data as Entry[]) || [];
  const matches = (matchesRes.data as Match[]) || [];

  return (
    <>
      {/* Print-only CSS — hide browser chrome / nav on print */}
      <style>{`
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
          .bracket-card { box-shadow: none !important; border-color: #d1d5db !important; }
          @page { size: landscape; margin: 0.4in; }
        }
        @media screen {
          body { background: #f9fafb; }
        }
      `}</style>

      <div className="min-h-screen bg-white text-gray-900">
        <PrintBar
          name={e.name}
          date={e.event_date}
          format={FORMAT_LABELS[e.match_format]}
        />

        <main className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6 print:px-0 print:py-2">
          {/* Title block */}
          <div className="mb-6 print:mb-3">
            <h1 className="text-3xl font-bold print:text-2xl">{e.name}</h1>
            <p className="text-sm text-gray-600 print:text-xs">
              {FORMAT_LABELS[e.match_format]}
              {e.event_date && ` · ${format(new Date(e.event_date), 'EEEE, MMMM d, yyyy')}`}
              {e.event_date !== e.end_date && e.end_date && ` – ${format(new Date(e.end_date), 'MMMM d, yyyy')}`}
            </p>
          </div>

          <DrawView
            format={e.match_format}
            entries={entries}
            matches={matches}
            revealAllSeeds={false}
          />

          <footer className="mt-8 pt-4 border-t border-gray-200 text-[10px] text-gray-500 text-center print:mt-3">
            club.coachmode.ai · printed {format(new Date(), 'MMM d, yyyy h:mm a')}
          </footer>
        </main>
      </div>
    </>
  );
}

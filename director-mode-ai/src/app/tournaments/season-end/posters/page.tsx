import QRCode from 'qrcode';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import PrintButton from './PrintButton';

export const dynamic = 'force-dynamic';

// One full-page, print-ready QR poster per season-end division. Post at each
// venue so players, parents, and coaches can scan straight to that division's
// live results & standings. QR codes are rendered SERVER-SIDE as <img> data
// URLs so they print crisp and never split across a page break.
const DIRECTOR_ID = '7ff5078a-ee6d-46b7-9af7-20b35f62729d';
const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://club.coachmode.ai').replace(/\/$/, '');

const FORMAT_LABELS: Record<string, string> = {
  'rr-singles': 'Round Robin',
  'rr-doubles': 'Round Robin — Doubles',
  'compass-singles': 'Compass Draw of 16',
  'compass-doubles': 'Compass Draw — Doubles',
  'single-elim-singles': 'Single Elimination',
  'ffic-singles': 'Full Feed-In',
};

function sortKey(name: string): number {
  if (/10U/i.test(name)) return name.toLowerCase().includes('silver') ? 12 : 11;
  if (/12U/i.test(name)) return 20;
  if (/13\s*&|13&O|13 ?& ?Over/i.test(name)) return 30;
  if (/open/i.test(name)) return 40;
  return 50;
}

function parseName(name: string): { title: string; venue: string | null } {
  const parts = name.split('·').map((s) => s.trim());
  const venue = parts.length > 1 ? parts[parts.length - 1] : null;
  let title = parts[0]
    .replace(/^JTT\s+/i, '')
    .replace(/\s*Season-End\s*(Tournament)?/i, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (title.endsWith('—')) title = title.slice(0, -1).trim();
  return { title: title || parts[0], venue };
}

type Ev = { id: string; name: string; slug: string | null; match_format: string | null };

export default async function SeasonEndPostersPage() {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('events')
    .select('id, name, slug, match_format, public_status')
    .eq('user_id', DIRECTOR_ID)
    .ilike('name', '%season-end%')
    .in('public_status', ['open', 'running', 'completed'])
    .order('event_date');

  const events = ((data as Ev[]) || [])
    .filter((e) => !!e.slug)
    .sort((a, b) => sortKey(a.name) - sortKey(b.name) || a.name.localeCompare(b.name));

  const posters = await Promise.all(
    events.map(async (e) => {
      const url = `${BASE_URL}/tournaments/${e.slug}/results`;
      const qr = await QRCode.toDataURL(url, { width: 900, margin: 1, errorCorrectionLevel: 'M' });
      const { title, venue } = parseName(e.name);
      return { id: e.id, title, venue, format: FORMAT_LABELS[e.match_format || ''] || e.match_format, url, qr };
    })
  );

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900">
      <style>{`
        @media print {
          @page { margin: 0.4in; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .poster { break-after: page; box-shadow: none !important; border: 0 !important; min-height: 92vh; }
          .poster:last-child { break-after: auto; }
        }
        .poster { break-inside: avoid; }
      `}</style>

      <div className="no-print sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold truncate">Season-End QR Posters</div>
          <div className="text-xs text-gray-500">{posters.length} posters · one per page · scan → live results</div>
        </div>
        <PrintButton />
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 print:p-0 print:space-y-0">
        {posters.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center text-gray-500">No season-end draws are live yet.</div>
        ) : (
          posters.map((p) => (
            <div
              key={p.id}
              className="poster bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col items-center text-center px-8 py-12 print:rounded-none"
            >
              <div className="text-sm uppercase tracking-[0.2em] text-gray-500 font-bold">
                Lamorinda JTT · Season-End Championships
              </div>
              <h1 className="mt-3 text-5xl font-black leading-tight">{p.title}</h1>
              {p.venue && <div className="mt-2 text-2xl text-gray-700 font-semibold">{p.venue}</div>}
              {p.format && <div className="mt-1 text-lg text-gray-500">{p.format}</div>}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.qr}
                alt={`QR code — ${p.title} live results`}
                className="mt-8 w-72 h-72 sm:w-80 sm:h-80"
              />

              <div className="mt-6 text-3xl font-extrabold text-gray-900">Scan for LIVE results</div>
              <div className="mt-1 text-lg text-gray-600">Standings update as scores come in</div>
              <div className="mt-4 text-sm font-mono text-gray-400 break-all">{p.url}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

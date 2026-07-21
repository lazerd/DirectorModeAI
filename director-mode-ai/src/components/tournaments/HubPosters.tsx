import PrintButton from './PrintButton';

export type HubPoster = {
  id: string;
  title: string;
  venue: string | null;
  format: string | null;
  url: string;
  qr: string; // data URL
};

/**
 * Shared printable QR-poster sheet — one full page per division, each with a
 * big server-rendered QR image (scan → live results) that prints crisp and
 * never splits across a page. The route generates the QR data URLs and passes
 * them in.
 */
export default function HubPosters({
  eyebrow,
  posters,
}: {
  eyebrow: string;
  posters: HubPoster[];
}) {
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
          <div className="font-bold truncate">QR Posters</div>
          <div className="text-xs text-gray-500">{posters.length} posters · one per page · scan → live results</div>
        </div>
        <PrintButton />
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 print:p-0 print:space-y-0">
        {posters.length === 0 ? (
          <div className="bg-white rounded-2xl p-10 text-center text-gray-500">No draws are live in this hub yet.</div>
        ) : (
          posters.map((p) => (
            <div
              key={p.id}
              className="poster bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col items-center text-center px-8 py-12 print:rounded-none"
            >
              <div className="text-sm uppercase tracking-[0.2em] text-gray-500 font-bold">{eyebrow}</div>
              <h1 className="mt-3 text-5xl font-black leading-tight">{p.title}</h1>
              {p.venue && <div className="mt-2 text-2xl text-gray-700 font-semibold">{p.venue}</div>}
              {p.format && <div className="mt-1 text-lg text-gray-500">{p.format}</div>}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.qr} alt={`QR code — ${p.title} live results`} className="mt-8 w-72 h-72 sm:w-80 sm:h-80" />

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

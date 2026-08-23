import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Order of play — QR poster',
};

/**
 * Printable QR poster for the desk and the court fences.
 *
 * A page rather than a one-off PDF so it can be reprinted any time without
 * regenerating anything, and so the QR always points at the live board for
 * whatever tournament slug it is opened with. Open it and press Ctrl+P.
 *
 * The QR is rendered as SVG: vector stays sharp at poster size, where a
 * bitmap scaled up starts costing you scans from a few feet away.
 */
export default async function PosterPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ title?: string; sub?: string }>;
}) {
  const { slug } = await params;
  const { title, sub } = await searchParams;

  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'https://club.coachmode.ai';
  const url = `${base}/tournaments/wait/${slug}`;

  // High error correction: the poster will get taped to a fence, rained on,
  // and half-covered by a thumb, and it still needs to scan.
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 1,
  });

  return (
    <>
      <style>{`
        @page { size: Letter portrait; margin: 0; }
        @media print {
          /* The app chrome is useful on screen and noise on paper. */
          body > *:not(.poster-root) { display: none !important; }
          .poster-root { position: absolute; inset: 0; }
        }
      `}</style>
      <div className="poster-root" style={S.page}>
        <div style={S.kicker}>{title ?? 'SLEEPY HOLLOW SWIM & TENNIS CLUB'}</div>
        <h1 style={S.h1}>How much<br />longer?</h1>
        <div style={S.sub}>{sub ?? 'Level 5 Junior Championships'}</div>

        <div style={S.qr} dangerouslySetInnerHTML={{ __html: svg }} />

        <div style={S.scan}>Point your camera here</div>
        <div style={S.url}>{url}</div>

        <ul style={S.list}>
          <li><b style={S.b}>Live</b> order of play &amp; court numbers</li>
          <li><b style={S.b}>Search your name</b> for your wait time</li>
          <li>Updates by itself — no app needed</li>
        </ul>

        <div style={S.foot}>
          Times are estimates and move with the tennis. Please stay on site.
        </div>
      </div>
    </>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: {
    width: '8.5in', minHeight: '11in', margin: '0 auto', padding: '0.7in 0.6in',
    background: '#fff', color: '#0b1b2b', textAlign: 'center',
    fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  kicker: { fontSize: '23pt', fontWeight: 700, letterSpacing: '.02em', color: '#095896' },
  h1: { fontSize: '60pt', lineHeight: 1.02, fontWeight: 800, margin: '.10in 0 .06in', letterSpacing: '-.02em' },
  sub: { fontSize: '26pt', fontWeight: 600, color: '#334155', marginBottom: '.30in' },
  qr: { width: '4.5in', height: '4.5in', padding: '.16in', border: '5px solid #095896', borderRadius: '.22in' },
  scan: { fontSize: '27pt', fontWeight: 800, marginTop: '.24in' },
  url: { fontSize: '15pt', color: '#475569', marginTop: '.10in', wordBreak: 'break-all' },
  list: { listStyle: 'none', padding: 0, margin: '.30in 0 0', fontSize: '19pt', lineHeight: 1.85 },
  b: { color: '#095896' },
  foot: { marginTop: '.40in', fontSize: '13pt', color: '#64748b' },
};

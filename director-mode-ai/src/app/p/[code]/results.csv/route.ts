import { loadResults } from '@/lib/play/resultsData';
import { drawResultsCsv, fileSlug, resultsCsv } from '@/lib/play/results';

/** /p/<code>/results.csv — standings (a tournament: places) and every match, for a spreadsheet. Public and read-only, like the page. */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const e = await loadResults(params.code);
  if (!e) return new Response('Not found', { status: 404 });
  const csv = e.format === 'tournament' && e.state.draw ? drawResultsCsv(e.state.draw) : resultsCsv(e.state.mixer);
  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileSlug(e.title, e.code)}-results.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

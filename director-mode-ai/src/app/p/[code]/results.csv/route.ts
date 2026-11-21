import { loadResults } from '@/lib/play/resultsData';
import { fileSlug, resultsCsv } from '@/lib/play/results';

/** /p/<code>/results.csv — standings and every match, for a spreadsheet. Public and read-only, like the page. */
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { code: string } }) {
  const e = await loadResults(params.code);
  if (!e) return new Response('Not found', { status: 404 });
  return new Response('﻿' + resultsCsv(e.state.mixer), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileSlug(e.title, e.code)}-results.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

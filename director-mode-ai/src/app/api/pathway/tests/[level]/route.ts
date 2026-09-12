/**
 * A ball color's string tests, as a PDF.
 *
 *   GET /api/pathway/tests/red   ->  red-ball-string-tests.pdf
 *
 * Public on purpose: this is the published curriculum, the same for every club,
 * with no player data in it. A coach, a parent or a club thinking about the
 * program can print it without an account — which is the point of the QR code
 * on the fence.
 */

import { NextResponse } from 'next/server';
import { LEVEL_BY_KEY, LEVEL_KEYS, type LevelKey } from '@/lib/pathway/curriculum';
import { buildLevelTestPdf, pdfFileName } from '@/lib/pathway/testPdf';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ level: string }> },
) {
  const { level } = await params;
  const key = level.toLowerCase() as LevelKey;
  if (!LEVEL_KEYS.includes(key)) {
    return NextResponse.json(
      { error: `Unknown level. Try one of: ${LEVEL_KEYS.join(', ')}` },
      { status: 404 },
    );
  }

  const bytes = await buildLevelTestPdf(key);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${pdfFileName(LEVEL_BY_KEY[key])}"`,
      // Curriculum content, versioned with the deploy — safe to cache hard.
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}

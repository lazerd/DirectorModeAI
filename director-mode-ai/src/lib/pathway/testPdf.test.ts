import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildLevelTestPdf, pdfFileName } from './testPdf';
import { LEVELS, LEVEL_BY_KEY } from './curriculum';

/**
 * These sheets get printed and carried onto a court, so the thing worth
 * guarding is that every color still produces a real, multi-page document —
 * a wrap bug or a bad page break would otherwise show up as a coach holding
 * a blank page.
 */
describe('buildLevelTestPdf', () => {
  it('builds a real PDF for every level', async () => {
    for (const level of LEVELS) {
      const bytes = await buildLevelTestPdf(level.key);
      expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBeGreaterThan(0);
    }
  });

  it('fits a full color onto more than one page, and HP onto one', async () => {
    // Red carries 5 strings x 3 tests with all four layers of detail — if that
    // ever collapses to a single page, text is being dropped.
    const red = await PDFDocument.load(await buildLevelTestPdf('red'));
    expect(red.getPageCount()).toBeGreaterThanOrEqual(2);

    // High Performance has no stripes: one page that says so.
    const hp = await PDFDocument.load(await buildLevelTestPdf('hp'));
    expect(hp.getPageCount()).toBe(1);
  });

  it('names the file after the color', () => {
    expect(pdfFileName(LEVEL_BY_KEY.red)).toBe('red-ball-string-tests.pdf');
    expect(pdfFileName(LEVEL_BY_KEY.hp)).toBe('high-performance-string-tests.pdf');
  });

  it('refuses a level that does not exist', async () => {
    await expect(buildLevelTestPdf('purple' as never)).rejects.toThrow(/Unknown pathway level/);
  });
});

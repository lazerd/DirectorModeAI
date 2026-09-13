import { describe, it, expect } from 'vitest';
import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { buildEventPoster } from './posterPdf';
import { DISPLAY_THEMES, DEFAULT_THEME } from './displayTheme';

/**
 * A poster is printed twenty at a time and pinned to a wall, so the failures
 * that matter are silent ones: text running off the page, an overlap, or a PDF
 * that opens blank. Rendering it here is the only way to know it did not.
 */

async function qr() {
  return new Uint8Array(
    await QRCode.toBuffer('https://clubmode.ai/event/USO0913', {
      type: 'png',
      width: 300,
      errorCorrectionLevel: 'H',
    }),
  );
}

const base = {
  eventName: 'US Open Tennis Social 2026',
  whenLine: 'Sunday, September 13 · 9am–11am',
  venue: 'Sleepy Hollow Swim & Tennis Club',
  eventCode: 'USO0913',
  publicUrl: 'https://clubmode.ai/event/USO0913',
  theme: DISPLAY_THEMES['us-open'],
};

describe('buildEventPoster', () => {
  it('renders a real single-page US Letter PDF', async () => {
    const bytes = await buildEventPoster({ ...base, qrPng: await qr() });

    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');

    /*
     * Loaded back rather than grepped. pdf-lib compresses object streams, so
     * searching the bytes for "/Type /Page" finds nothing even on a perfectly
     * good file — which is how a test like this passes while the PDF is blank.
     */
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(Math.round(width)).toBe(612);
    expect(Math.round(height)).toBe(792);
    // An embedded 300px QR plus two fonts — a blank page is a few hundred bytes.
    expect(bytes.length).toBeGreaterThan(3000);
  });

  it('renders in every theme, including unthemed', async () => {
    const png = await qr();
    for (const theme of [DEFAULT_THEME, ...Object.values(DISPLAY_THEMES)]) {
      const bytes = await buildEventPoster({ ...base, theme, qrPng: png });
      expect(bytes.length, theme.label).toBeGreaterThan(3000);
    }
  });

  it('survives the longest real event name without throwing', async () => {
    // The actual longest name in the database.
    const bytes = await buildEventPoster({
      ...base,
      eventName: 'Sleepy Hollow Level 5 Junior 12s & 14s Singles Championship',
      qrPng: await qr(),
    });
    expect(bytes.length).toBeGreaterThan(3000);
  });

  it('handles a missing date, venue and a junk palette', async () => {
    const bytes = await buildEventPoster({
      ...base,
      whenLine: null,
      venue: null,
      theme: { ...DEFAULT_THEME, ground: 'not-a-colour', accent: '' },
      qrPng: await qr(),
    });
    expect(bytes.length).toBeGreaterThan(3000);
  });

  it('ignores a logo that will not decode rather than losing the poster', async () => {
    const bytes = await buildEventPoster({
      ...base,
      qrPng: await qr(),
      logo: { bytes: new Uint8Array([1, 2, 3, 4]), type: 'png' },
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
});

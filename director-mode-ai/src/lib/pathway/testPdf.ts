/**
 * One ball color's string tests as a printable PDF.
 *
 * A coach on a court does not have a browser. They have a clipboard, a ball
 * cart and fifteen eight-year-olds — so the whole standard for a color has to
 * exist as a sheet of paper they can carry, with somewhere to tick each test
 * off as it is cleared.
 *
 * This is the curriculum only: no roster, no player names, no login. It is the
 * same document for every club on ClubMode, which is why it is built straight
 * from lib/pathway/curriculum rather than from the database. The roster version
 * — each enrolled kid and their next string — is /pathway/print.
 *
 * pdf-lib with the standard Helvetica faces: no font files to embed, no
 * headless browser, so it renders the same on a laptop and on a serverless
 * function.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { HOUSE_RULES, LEVEL_BY_KEY, type Level, type LevelKey } from './curriculum';

const PAGE = { w: 612, h: 792 }; // US Letter, the paper in every club's printer
const MARGIN = 48;
const CONTENT_W = PAGE.w - MARGIN * 2;

/** #rrggbb from the curriculum into pdf-lib's 0–1 triples. */
function hex(color: string) {
  const h = color.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const INK = rgb(0.11, 0.14, 0.13);
const MUTED = rgb(0.42, 0.45, 0.44);
const RULE = rgb(0.85, 0.85, 0.84);

/**
 * Greedy word wrap against the font's real measured widths.
 *
 * A single word longer than the line (no spaces to break on) is emitted as its
 * own line rather than dropped or looped on forever.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

type Ctx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  regular: PDFFont;
  bold: PDFFont;
  accent: ReturnType<typeof hex>;
  levelName: string;
};

function newPage(ctx: Ctx) {
  ctx.page = ctx.doc.addPage([PAGE.w, PAGE.h]);
  ctx.y = PAGE.h - MARGIN;
  // A rule in the color on every page, so a stack of four printouts can be
  // told apart by their edges.
  ctx.page.drawRectangle({ x: 0, y: PAGE.h - 6, width: PAGE.w, height: 6, color: ctx.accent });
  return ctx;
}

/** Start a new page when what comes next will not fit on this one. */
function ensure(ctx: Ctx, needed: number) {
  if (ctx.y - needed < MARGIN + 28) newPage(ctx);
}

function text(
  ctx: Ctx,
  body: string,
  opts: {
    size?: number;
    bold?: boolean;
    color?: ReturnType<typeof hex>;
    indent?: number;
    leading?: number;
    gapAfter?: number;
  } = {},
) {
  const size = opts.size ?? 10;
  const font = opts.bold ? ctx.bold : ctx.regular;
  const indent = opts.indent ?? 0;
  const leading = opts.leading ?? size * 1.38;
  const lines = wrap(body, font, size, CONTENT_W - indent);
  for (const line of lines) {
    ensure(ctx, leading);
    ctx.page.drawText(line, {
      x: MARGIN + indent,
      y: ctx.y - size,
      size,
      font,
      color: opts.color ?? INK,
    });
    ctx.y -= leading;
  }
  ctx.y -= opts.gapAfter ?? 0;
}

/** The tick box a coach actually uses on court. */
function checkbox(ctx: Ctx, yTop: number) {
  ctx.page.drawRectangle({
    x: MARGIN,
    y: yTop - 12,
    width: 11,
    height: 11,
    borderColor: MUTED,
    borderWidth: 0.9,
  });
}

export function pdfFileName(level: Level): string {
  return `${level.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-string-tests.pdf`;
}

export async function buildLevelTestPdf(levelKey: LevelKey): Promise<Uint8Array> {
  const level = LEVEL_BY_KEY[levelKey];
  if (!level) throw new Error(`Unknown pathway level: ${levelKey}`);

  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const ctx: Ctx = {
    doc,
    page: doc.addPage([PAGE.w, PAGE.h]),
    y: PAGE.h - MARGIN,
    regular,
    bold,
    accent: hex(level.color),
    levelName: level.name,
  };
  ctx.page.drawRectangle({ x: 0, y: PAGE.h - 6, width: PAGE.w, height: 6, color: ctx.accent });

  doc.setTitle(`${level.name} — String Tests · ClubMode Junior Pathway`);
  doc.setSubject('The full testing standard for this ball color.');
  doc.setCreator('ClubMode AI');

  // ---------------------------------------------------------------- heading
  text(ctx, 'THE JUNIOR PATHWAY', { size: 8.5, bold: true, color: MUTED, gapAfter: 4 });
  text(ctx, `${level.name.toUpperCase()} — STRING TESTS`, {
    size: 25,
    bold: true,
    color: ctx.accent,
    leading: 27,
    gapAfter: 6,
  });
  text(ctx, `${level.ball} · ${level.court}`, { size: 10, bold: true, color: MUTED, gapAfter: 3 });
  text(ctx, level.tagline, { size: 10.5, color: MUTED, gapAfter: 16 });

  if (level.stripes.length === 0) {
    // High Performance is an invitation tier, not a set of tests. Say that
    // rather than printing an empty sheet a coach would assume was a bug.
    text(ctx, 'No string tests at this level.', { size: 12, bold: true, gapAfter: 6 });
    text(
      ctx,
      `${level.name} is an invitation tier. There is nothing to test for here — a player earns the invitation by clearing the last string of the color below, and what happens afterwards is training, not testing.`,
      { size: 10.5, color: MUTED },
    );
    return doc.save();
  }

  // ------------------------------------------------------------ how it works
  text(ctx, 'HOW TEST DAY WORKS', { size: 8.5, bold: true, color: MUTED, gapAfter: 6 });
  HOUSE_RULES.forEach((rule, i) => {
    text(ctx, `${i + 1}.  ${rule}`, { size: 9.5, color: MUTED, indent: 2, gapAfter: 1 });
  });
  ctx.y -= 12;

  // ----------------------------------------------------- the strings & tests
  for (const stripe of level.stripes) {
    // Keep a string's header with at least the start of its first test.
    ensure(ctx, 96);

    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y + 6 },
      end: { x: PAGE.w - MARGIN, y: ctx.y + 6 },
      thickness: 0.8,
      color: RULE,
    });
    ctx.y -= 10;

    text(
      ctx,
      `STRING ${stripe.number}${stripe.promotes ? '  ·  PROMOTION TEST' : ''}`,
      { size: 8.5, bold: true, color: ctx.accent, gapAfter: 3 },
    );
    text(ctx, stripe.title, { size: 15, bold: true, leading: 17, gapAfter: 2 });
    if (stripe.promotes) {
      text(
        ctx,
        'Clear this one and the player moves up a ball color — announced in front of everybody.',
        { size: 9, color: MUTED, gapAfter: 4 },
      );
    }
    ctx.y -= 4;

    stripe.tests.forEach((test, i) => {
      ensure(ctx, 82);
      const boxTop = ctx.y;
      checkbox(ctx, boxTop);
      text(ctx, `${i + 1}.  ${test.label}`, {
        size: 11,
        bold: true,
        indent: 22,
        leading: 14,
        gapAfter: 3,
      });
      text(ctx, `What it measures:  ${test.what}`, {
        size: 9.5,
        color: MUTED,
        indent: 22,
        gapAfter: 2,
      });
      text(ctx, `How to run it:  ${test.how}`, {
        size: 9.5,
        color: MUTED,
        indent: 22,
        gapAfter: 2,
      });
      text(ctx, `Passing:  ${test.pass}`, { size: 9.5, indent: 22, gapAfter: 10 });
    });
  }

  // ------------------------------------------------------------- page footer
  const pages = doc.getPages();
  pages.forEach((page, i) => {
    page.drawText(`${level.name} string tests  ·  ClubMode Junior Pathway`, {
      x: MARGIN,
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
    const label = `${i + 1} of ${pages.length}`;
    page.drawText(label, {
      x: PAGE.w - MARGIN - regular.widthOfTextAtSize(label, 8),
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  return doc.save();
}

/**
 * generateResultsCard — premium dark redesign
 *
 * Visual language: near-black surface with a soft optic-lime glow,
 * Barlow Condensed display type, a single hero accent (#C8FB4F),
 * an elegant champion block, minimal podium + award chips, and a
 * dark-styled team-battle layout. Graceful empty space when no photos.
 *
 * IMPORTANT — fonts: this draws in Barlow / Barlow Condensed / Barlow
 * Semi Condensed. Those @font-faces are loaded globally (see app/layout.tsx
 * Google Fonts link); ensureFonts() awaits the specific weights before drawing.
 */

interface Standing {
  player_name: string;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  win_percentage: number;
  [key: string]: any;
}

interface EventPhoto {
  photo_url: string;
}

interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
}

interface ResultsCardData {
  eventName: string;
  eventDate: string;
  totalRounds: number;
  numCourts?: number;
  numPlayers?: number;
  topThree: Standing[];
  giantSlayer: Standing | null;
  mostConsistent: Standing | null;
  photos: EventPhoto[];
  format: "instagram" | "facebook";
  isTeamBattle?: boolean;
  teams?: Team[];
  winningTeam?: Team | null;
  logoUrl?: string | null;
  eyebrow?: string; // lime kicker above the title (defaults to "EVENT RESULTS")
}

/* ------------------------------------------------------------------ */
/* Design tokens                                                       */
/* ------------------------------------------------------------------ */
const C = {
  ink: "#0A0B0D",
  inkTop: "#181C22",
  accent: "#C8FB4F", // optic lime — single hero accent
  aqua: "#56E0FF", // secondary award accent (Giant Slayer)
  text: "#F4F6F4",
  text70: "rgba(244,246,244,0.70)",
  text55: "rgba(244,246,244,0.55)",
  text42: "rgba(244,246,244,0.42)",
  text38: "rgba(244,246,244,0.38)",
  faintNum: "rgba(244,246,244,0.22)",
  surface: "rgba(255,255,255,0.035)",
  surfaceSoft: "rgba(255,255,255,0.028)",
  border: "rgba(255,255,255,0.075)",
  borderSoft: "rgba(255,255,255,0.06)",
  hairline: "rgba(255,255,255,0.08)",
  champBorder: "rgba(200,251,79,0.22)",
  champFill1: "rgba(200,251,79,0.07)",
  champFill2: "rgba(255,255,255,0.025)",
  ghost: "rgba(200,251,79,0.13)",
};

const DISP = "'Barlow Condensed'";
const BODY = "'Barlow'";
const LABEL = "'Barlow Semi Condensed'";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
async function ensureFonts() {
  const f: any = (document as any).fonts;
  if (!f?.load) return;
  const specs = [
    `800 86px ${DISP}`,
    `900 86px ${DISP}`,
    `400 16px ${BODY}`,
    `500 16px ${BODY}`,
    `600 16px ${BODY}`,
    `700 16px ${BODY}`,
    `800 16px ${BODY}`,
    `600 13px ${LABEL}`,
    `700 13px ${LABEL}`,
  ];
  try {
    await Promise.all(specs.map((s) => f.load(s)));
    await f.ready;
  } catch {
    /* fall back to whatever is available */
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 4000);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawImageCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, radius: number) {
  ctx.save();
  roundRect(ctx, x, y, w, h, radius);
  ctx.clip();
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (imgRatio > boxRatio) {
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxWidth) t = t.slice(0, -1);
  return t + "…";
}

/** Letter-spaced text — canvas has no native tracking. */
function tracked(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, spacing: number, align: "left" | "center" = "left") {
  const widths = [...text].map((ch) => ctx.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let cx = align === "center" ? x - total / 2 : x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], cx, y);
    cx += widths[i];
  }
  ctx.textAlign = prev;
}

function fmtDatePill(eventDate: string): string {
  if (!eventDate) return "";
  // Parse date-only strings (YYYY-MM-DD) at local noon so the day doesn't shift
  // back one in negative-UTC timezones.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) ? new Date(eventDate + "T12:00:00") : new Date(eventDate);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */
function paintBackground(ctx: CanvasRenderingContext2D, W: number, H: number, glow: { x: number; y: number }) {
  const g = ctx.createRadialGradient(W * 0.5, -H * 0.12, 0, W * 0.5, -H * 0.12, H * 1.05);
  g.addColorStop(0, C.inkTop);
  g.addColorStop(0.56, C.ink);
  g.addColorStop(1, C.ink);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  const blob = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, 320);
  blob.addColorStop(0, "rgba(200,251,79,0.14)");
  blob.addColorStop(1, "rgba(200,251,79,0)");
  ctx.fillStyle = blob;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function drawLogoSlot(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, logo: HTMLImageElement | null, radius: number) {
  if (logo) {
    drawImageCover(ctx, logo, x, y, size, size, radius);
    return;
  }
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, x, y, size, size, radius);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, size, size, radius);
  ctx.stroke();
  ctx.fillStyle = C.text42;
  ctx.font = `700 10px ${LABEL}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  tracked(ctx, "LOGO", x + size / 2, y + size / 2 + 1, 1.2, "center");
  ctx.textBaseline = "alphabetic";
}

function drawDatePill(ctx: CanvasRenderingContext2D, rightX: number, centerY: number, label: string) {
  if (!label) return;
  ctx.font = `600 13px ${LABEL}`;
  const tw = [...label].reduce((a, ch) => a + ctx.measureText(ch).width + 1.6, 0) - 1.6;
  const padX = 16;
  const dot = 6;
  const gap = 8;
  const w = padX * 2 + dot + gap + tw;
  const h = 34;
  const x = rightX - w;
  const y = centerY - h / 2;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.09)";
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(x + padX + dot / 2, centerY, dot / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.text70;
  ctx.textBaseline = "middle";
  tracked(ctx, label, x + padX + dot + gap, centerY + 1, 1.6, "left");
  ctx.textBaseline = "alphabetic";
}

function drawFooterMark(ctx: CanvasRenderingContext2D, x: number, centerY: number, size: number) {
  ctx.fillStyle = C.accent;
  roundRect(ctx, x, centerY - size / 2, size, size, size * 0.28);
  ctx.fill();
  ctx.fillStyle = C.ink;
  ctx.font = `800 ${Math.round(size * 0.4)}px ${DISP}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("cm", x + size / 2, centerY + 1);
  ctx.textBaseline = "alphabetic";
}

function drawFooter(ctx: CanvasRenderingContext2D, leftX: number, rightX: number, fy: number, isIG: boolean) {
  ctx.strokeStyle = C.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(leftX, fy - (isIG ? 30 : 28));
  ctx.lineTo(rightX, fy - (isIG ? 30 : 28));
  ctx.stroke();
  ctx.fillStyle = C.text42;
  ctx.font = `600 ${isIG ? 11 : 10}px ${LABEL}`;
  ctx.textAlign = "left";
  tracked(ctx, "RUN YOUR NEXT EVENT AT", leftX, fy - 12, isIG ? 1.8 : 1.6, "left");
  ctx.fillStyle = C.text;
  ctx.font = `800 ${isIG ? 24 : 21}px ${DISP}`;
  ctx.fillText("club.coachmode.ai", leftX, fy + (isIG ? 12 : 9));
  const mark = isIG ? 46 : 40;
  drawFooterMark(ctx, rightX - mark, fy - (isIG ? 4 : 6), mark);
}

/* Champion card — returns the y after the card */
function drawChampion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  opts: { nameSize: number; statSize: number; pad: number; champ: Standing }
): number {
  const { nameSize, statSize, pad, champ } = opts;
  const h = pad + 16 + 10 + nameSize + 24 + statSize + 16 + pad - 18;

  const fill = ctx.createLinearGradient(x, y, x, y + h);
  fill.addColorStop(0, C.champFill1);
  fill.addColorStop(1, C.champFill2);
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, 28);
  ctx.fill();
  ctx.strokeStyle = C.champBorder;
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, 28);
  ctx.stroke();

  ctx.save();
  roundRect(ctx, x, y, w, h, 28);
  ctx.clip();
  ctx.fillStyle = C.ghost;
  ctx.font = `900 ${Math.round(nameSize * 2.6)}px ${DISP}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("1", x + w - 22, y + nameSize * 2.05);
  ctx.restore();

  let cy = y + pad;
  ctx.fillStyle = C.accent;
  ctx.beginPath();
  ctx.arc(x + pad + 3.5, cy + 7, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `700 13px ${LABEL}`;
  ctx.textBaseline = "alphabetic";
  tracked(ctx, "CHAMPION", x + pad + 17, cy + 11, 2.4, "left");

  cy += 11 + 10;
  ctx.fillStyle = C.text;
  ctx.font = `800 ${nameSize}px ${DISP}`;
  ctx.textAlign = "left";
  ctx.fillText(truncate(ctx, champ.player_name.toUpperCase(), w - pad * 2 - nameSize * 1.2), x + pad, cy + nameSize * 0.8);

  cy += nameSize * 0.8 + 26;
  const diff = champ.games_won - champ.games_lost;
  const cells: [string, string, boolean][] = [
    [`${champ.wins}–${champ.losses}`, "RECORD", false],
    [`${Math.round(champ.win_percentage)}%`, "WIN RATE", false],
    [`${diff >= 0 ? "+" : ""}${diff}`, "GAME DIFF", true],
  ];
  let sx = x + pad;
  cells.forEach((cell, i) => {
    ctx.textAlign = "left";
    ctx.fillStyle = cell[2] ? C.accent : C.text;
    ctx.font = `800 ${statSize}px ${DISP}`;
    ctx.fillText(cell[0], sx, cy + statSize * 0.78);
    ctx.fillStyle = C.text42;
    ctx.font = `600 11px ${LABEL}`;
    tracked(ctx, cell[1], sx, cy + statSize * 0.78 + 16, 1.6, "left");
    ctx.font = `800 ${statSize}px ${DISP}`;
    const realValW = ctx.measureText(cell[0]).width;
    const labelW = (() => {
      ctx.font = `600 11px ${LABEL}`;
      return [...cell[1]].reduce((a, ch) => a + ctx.measureText(ch).width + 1.6, 0);
    })();
    sx += Math.max(realValW, labelW) + 26;
    if (i < cells.length - 1) {
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(sx - 13, cy + 4, 1, statSize + 6);
    }
  });

  return y + h;
}

function drawPlace(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rank: number, p: Standing, label: string) {
  ctx.fillStyle = C.surface;
  roundRect(ctx, x, y, w, h, 20);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 20);
  ctx.stroke();

  ctx.fillStyle = C.faintNum;
  ctx.font = `800 42px ${DISP}`;
  ctx.textAlign = "left";
  ctx.fillText(String(rank), x + 22, y + h / 2 + 15);

  const tx = x + 64;
  ctx.fillStyle = C.text42;
  ctx.font = `600 11px ${LABEL}`;
  tracked(ctx, label, tx, y + 30, 1.6, "left");
  ctx.fillStyle = C.text;
  ctx.font = `800 24px ${DISP}`;
  ctx.fillText(truncate(ctx, p.player_name.toUpperCase(), w - 64 - 80), tx, y + 56);

  ctx.textAlign = "right";
  ctx.fillStyle = C.text;
  ctx.font = `800 22px ${DISP}`;
  ctx.fillText(`${p.wins}–${p.losses}`, x + w - 24, y + h / 2 - 2);
  ctx.fillStyle = C.text38;
  ctx.font = `600 10px ${LABEL}`;
  ctx.textAlign = "left";
  const rl = "RECORD";
  const rlw = [...rl].reduce((a, ch) => a + ctx.measureText(ch).width + 1.4, 0) - 1.4;
  tracked(ctx, rl, x + w - 24 - rlw, y + h / 2 + 16, 1.4, "left");
  ctx.textAlign = "left";
}

function drawAward(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, p: Standing, sub: string, color: string) {
  ctx.fillStyle = C.surfaceSoft;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 18);
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 24, y + h / 2, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const tx = x + 42;
  ctx.fillStyle = color;
  ctx.font = `700 11px ${LABEL}`;
  ctx.textAlign = "left";
  tracked(ctx, label.toUpperCase(), tx, y + 26, 1.6, "left");
  ctx.fillStyle = C.text;
  ctx.font = `700 17px ${BODY}`;
  ctx.fillText(truncate(ctx, p.player_name, w - 42 - 16), tx, y + 47);
  if (sub) {
    ctx.fillStyle = C.text42;
    ctx.font = `500 12px ${BODY}`;
    ctx.fillText(truncate(ctx, sub, w - 42 - 16), tx, y + 64);
  }
}

function drawPhotos(ctx: CanvasRenderingContext2D, imgs: HTMLImageElement[], x: number, y: number, w: number, h: number) {
  const r = 22;
  const gap = 12;
  if (imgs.length === 1) {
    drawImageCover(ctx, imgs[0], x, y, w, h, r);
  } else if (imgs.length === 2) {
    const pw = (w - gap) / 2;
    drawImageCover(ctx, imgs[0], x, y, pw, h, r);
    drawImageCover(ctx, imgs[1], x + pw + gap, y, pw, h, r);
  } else if (imgs.length === 3) {
    const big = (w - gap) * 0.56;
    const small = w - big - gap;
    const sh = (h - gap) / 2;
    drawImageCover(ctx, imgs[0], x, y, big, h, r);
    drawImageCover(ctx, imgs[1], x + big + gap, y, small, sh, r);
    drawImageCover(ctx, imgs[2], x + big + gap, y + sh + gap, small, sh, r);
  } else {
    const pw = (w - gap) / 2;
    const ph = (h - gap) / 2;
    drawImageCover(ctx, imgs[0], x, y, pw, ph, r);
    drawImageCover(ctx, imgs[1], x + pw + gap, y, pw, ph, r);
    drawImageCover(ctx, imgs[2], x, y + ph + gap, pw, ph, r);
    drawImageCover(ctx, imgs[3], x + pw + gap, y + ph + gap, pw, ph, r);
  }
}

/* ------------------------------------------------------------------ */
/* MAIN                                                                */
/* ------------------------------------------------------------------ */
export async function generateResultsCard(data: ResultsCardData): Promise<Blob> {
  const {
    eventName, eventDate, totalRounds, numCourts, numPlayers,
    topThree, giantSlayer, mostConsistent, photos, format,
    isTeamBattle, teams, winningTeam, logoUrl, eyebrow,
  } = data;

  await ensureFonts();

  const isIG = format === "instagram";
  const W = isIG ? 1080 : 1200;
  const H = isIG ? 1080 : 630;
  const scale = 2;
  const PAD = isIG ? 60 : 52;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  paintBackground(ctx, W, H, isIG ? { x: W - 60, y: -60 } : { x: 80, y: -60 });

  const logo = logoUrl ? await loadImage(logoUrl) : null;
  const meta = [`${totalRounds} Rounds`, numCourts ? `${numCourts} Courts` : null, numPlayers ? `${numPlayers} Players` : null]
    .filter(Boolean)
    .join(" · ");
  const eb = (eyebrow || (isTeamBattle ? "TEAM BATTLE" : "EVENT RESULTS")).toUpperCase();

  const toBlob = () =>
    new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), "image/jpeg", 0.95);
    });

  /* ================= TEAM BATTLE ================= */
  if (isTeamBattle && teams && teams.length >= 1) {
    drawLogoSlot(ctx, PAD, PAD, isIG ? 56 : 50, logo, isIG ? 16 : 14);
    drawDatePill(ctx, isIG ? W - PAD : PAD + 430, PAD + (isIG ? 28 : 25), fmtDatePill(eventDate));

    let y = PAD + (isIG ? 56 : 50) + 30;
    ctx.fillStyle = C.accent;
    ctx.font = `700 13px ${LABEL}`;
    ctx.textAlign = "left";
    tracked(ctx, eb, PAD, y, 2.6, "left");
    y += 24;
    ctx.fillStyle = C.text;
    ctx.font = `800 ${isIG ? 86 : 62}px ${DISP}`;
    ctx.textAlign = "left";
    ctx.fillText(truncate(ctx, eventName.toUpperCase(), W - PAD * 2), PAD, y + (isIG ? 70 : 50));
    y += (isIG ? 70 : 50) + 26;
    ctx.fillStyle = C.text55;
    ctx.font = `500 ${isIG ? 16 : 14}px ${BODY}`;
    ctx.fillText(meta, PAD, y);

    const footerY = H - PAD - 10;
    const blockTop = y + (isIG ? 40 : 24);
    const blockH = footerY - 42 - blockTop;
    ctx.fillStyle = C.surface;
    roundRect(ctx, PAD, blockTop, W - PAD * 2, blockH, 28);
    ctx.fill();
    ctx.strokeStyle = C.champBorder;
    ctx.lineWidth = 1.5;
    roundRect(ctx, PAD, blockTop, W - PAD * 2, blockH, 28);
    ctx.stroke();

    const midX = W / 2;
    ctx.fillStyle = C.text42;
    ctx.font = `700 12px ${LABEL}`;
    tracked(ctx, "FINAL SCORE", midX, blockTop + 42, 2, "center");

    const off = isIG ? 175 : 150;
    const cy = blockTop + blockH / 2 + 12;
    const drawTeam = (t: Team | undefined, tcx: number) => {
      if (!t) return;
      ctx.textAlign = "center";
      ctx.fillStyle = t.color || C.accent;
      ctx.font = `900 ${isIG ? 112 : 84}px ${DISP}`;
      ctx.fillText(String(t.score), tcx, cy);
      ctx.fillStyle = C.text;
      ctx.font = `700 ${isIG ? 24 : 20}px ${DISP}`;
      ctx.fillText(truncate(ctx, (t.name || "").toUpperCase(), off * 1.5), tcx, cy + (isIG ? 44 : 36));
    };
    drawTeam(teams[0], midX - off);
    drawTeam(teams[1], midX + off);

    ctx.textAlign = "center";
    ctx.fillStyle = C.text38;
    ctx.font = `800 ${isIG ? 30 : 24}px ${DISP}`;
    ctx.fillText("VS", midX, cy - (isIG ? 22 : 16));

    if (winningTeam) {
      const label = `WINNER — ${(winningTeam.name || "").toUpperCase()}`;
      ctx.font = `700 ${isIG ? 14 : 12}px ${LABEL}`;
      const tw = [...label].reduce((a, ch) => a + ctx.measureText(ch).width + 1.8, 0) - 1.8;
      const padX = 22;
      const ph = isIG ? 42 : 36;
      const pw = tw + padX * 2;
      const px = midX - pw / 2;
      const py = blockTop + blockH - ph - 22;
      ctx.fillStyle = C.accent;
      roundRect(ctx, px, py, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.textBaseline = "middle";
      tracked(ctx, label, px + padX, py + ph / 2 + 1, 1.8, "left");
      ctx.textBaseline = "alphabetic";
    }

    drawFooter(ctx, PAD, W - PAD, footerY, isIG);
    return toBlob();
  }

  /* ================= INDIVIDUAL ================= */
  const loaded: HTMLImageElement[] = [];
  for (const p of (photos || []).slice(0, 4)) {
    const img = await loadImage(p.photo_url);
    if (img) loaded.push(img);
  }
  const champ = topThree[0];

  if (isIG) {
    /* ---------------- INSTAGRAM 1080×1080 ---------------- */
    drawLogoSlot(ctx, PAD, PAD, 56, logo, 16);
    drawDatePill(ctx, W - PAD, PAD + 28, fmtDatePill(eventDate));

    let y = PAD + 56 + 30;
    ctx.fillStyle = C.accent;
    ctx.font = `700 13px ${LABEL}`;
    tracked(ctx, eb, PAD, y, 2.6, "left");
    y += 24;
    ctx.fillStyle = C.text;
    ctx.font = `800 86px ${DISP}`;
    ctx.textAlign = "left";
    ctx.fillText(truncate(ctx, eventName.toUpperCase(), W - PAD * 2), PAD, y + 70);
    y += 70 + 28;
    ctx.fillStyle = C.text55;
    ctx.font = `500 16px ${BODY}`;
    ctx.fillText(meta, PAD, y);

    let contentTop = y + 30;
    const contentBottom = H - PAD - 24 - 50;
    if (loaded.length) {
      const ph = 212;
      drawPhotos(ctx, loaded, PAD, contentTop, W - PAD * 2, ph);
      contentTop += ph + 28;
    }

    const blockGap = 16;
    const placeH = 92;
    const awardH = 96;
    const champEstimate = 30 + 56 + 26 + 30 + 18 + 60;
    const totalBlock = champEstimate + blockGap + placeH + blockGap + awardH;
    let by = contentTop + Math.max(0, (contentBottom - contentTop - totalBlock) / 2);

    if (champ) {
      by = drawChampion(ctx, PAD, by, W - PAD * 2, { nameSize: 56, statSize: 30, pad: 30, champ });
      by += blockGap;
    }

    const halfW = (W - PAD * 2 - 14) / 2;
    if (topThree[1]) drawPlace(ctx, PAD, by, halfW, placeH, 2, topThree[1], "RUNNER-UP");
    if (topThree[2]) drawPlace(ctx, PAD + halfW + 14, by, halfW, placeH, 3, topThree[2], "THIRD PLACE");
    by += placeH + blockGap;

    if (giantSlayer) drawAward(ctx, PAD, by, halfW, awardH, "Giant Slayer", giantSlayer, `${giantSlayer.wins} wins · upsets`, C.aqua);
    if (mostConsistent) {
      const md = mostConsistent.games_won - mostConsistent.games_lost;
      drawAward(ctx, PAD + halfW + 14, by, halfW, awardH, "Most Consistent", mostConsistent, `+${md} game differential`, C.accent);
    }

    drawFooter(ctx, PAD, W - PAD, H - PAD - 10, true);
  } else {
    /* ---------------- FACEBOOK 1200×630 ---------------- */
    const colGap = 46;
    const leftW = 430;
    const rightX = PAD + leftW + colGap;
    const rightW = W - PAD - rightX;

    drawLogoSlot(ctx, PAD, PAD, 50, logo, 14);
    drawDatePill(ctx, PAD + leftW, PAD + 25, fmtDatePill(eventDate));

    let ly = PAD + 50 + 26;
    ctx.fillStyle = C.accent;
    ctx.font = `700 12px ${LABEL}`;
    tracked(ctx, eb, PAD, ly, 2.4, "left");
    ly += 22;
    ctx.fillStyle = C.text;
    ctx.font = `800 62px ${DISP}`;
    ctx.textAlign = "left";
    const words = eventName.toUpperCase().split(" ");
    const lines: string[] = [];
    let line = "";
    for (const wd of words) {
      const test = line ? line + " " + wd : wd;
      if (ctx.measureText(test).width > leftW && line) {
        lines.push(line);
        line = wd;
      } else line = test;
    }
    if (line) lines.push(line);
    lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, PAD, ly + 50 + i * 56));
    ly += 50 + (Math.min(lines.length, 2) - 1) * 56 + 22;
    ctx.fillStyle = C.text55;
    ctx.font = `500 14px ${BODY}`;
    ctx.fillText(meta, PAD, ly);
    ly += 22;

    const footerTop = H - PAD - 50;
    if (loaded.length) {
      const photoTop = ly + 4;
      const photoH = footerTop - 18 - photoTop;
      if (photoH > 60) drawImageCover(ctx, loaded[0], PAD, photoTop, leftW, photoH, 20);
    }

    drawFooter(ctx, PAD, PAD + leftW, H - PAD - 8, false);

    const placeH = 70;
    const awardH = 66;
    const gap = 14;
    const champH = 30 + 48 + 22 + 27 + 18 + 52;
    const groupH = champH + gap + placeH + gap + awardH;
    let ry = PAD + Math.max(0, (H - PAD * 2 - groupH) / 2);

    if (champ) {
      ry = drawChampion(ctx, rightX, ry, rightW, { nameSize: 48, statSize: 27, pad: 26, champ });
      ry += gap;
    }
    const rHalf = (rightW - 12) / 2;
    if (topThree[1]) drawPlaceCompact(ctx, rightX, ry, rHalf, placeH, 2, topThree[1], "RUNNER-UP");
    if (topThree[2]) drawPlaceCompact(ctx, rightX + rHalf + 12, ry, rHalf, placeH, 3, topThree[2], "THIRD");
    ry += placeH + gap;
    if (giantSlayer) drawAwardCompact(ctx, rightX, ry, rHalf, awardH, "Giant Slayer", giantSlayer, C.aqua);
    if (mostConsistent) drawAwardCompact(ctx, rightX + rHalf + 12, ry, rHalf, awardH, "Most Consistent", mostConsistent, C.accent);
  }

  return toBlob();
}

/* compact variants for the Facebook right column */
function drawPlaceCompact(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rank: number, p: Standing, label: string) {
  ctx.fillStyle = C.surface;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 18);
  ctx.stroke();
  ctx.fillStyle = C.faintNum;
  ctx.font = `800 34px ${DISP}`;
  ctx.textAlign = "left";
  ctx.fillText(String(rank), x + 18, y + h / 2 + 12);
  const tx = x + 54;
  ctx.fillStyle = C.text42;
  ctx.font = `600 10px ${LABEL}`;
  tracked(ctx, label, tx, y + 26, 1.4, "left");
  ctx.fillStyle = C.text;
  ctx.font = `800 20px ${DISP}`;
  ctx.fillText(truncate(ctx, p.player_name.toUpperCase(), w - 54 - 56), tx, y + 48);
  ctx.textAlign = "right";
  ctx.fillStyle = C.text;
  ctx.font = `800 19px ${DISP}`;
  ctx.fillText(`${p.wins}–${p.losses}`, x + w - 16, y + h / 2 + 7);
  ctx.textAlign = "left";
}

function drawAwardCompact(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, label: string, p: Standing, color: string) {
  ctx.fillStyle = C.surfaceSoft;
  roundRect(ctx, x, y, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = C.borderSoft;
  ctx.lineWidth = 1;
  roundRect(ctx, x, y, w, h, 16);
  ctx.stroke();
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x + 20, y + h / 2, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  const tx = x + 36;
  ctx.fillStyle = color;
  ctx.font = `700 10px ${LABEL}`;
  ctx.textAlign = "left";
  tracked(ctx, label.toUpperCase(), tx, y + 28, 1.4, "left");
  ctx.fillStyle = C.text;
  ctx.font = `700 15px ${BODY}`;
  ctx.fillText(truncate(ctx, p.player_name, w - 36 - 14), tx, y + 48);
}

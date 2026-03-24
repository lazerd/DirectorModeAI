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
  topThree: Standing[];
  giantSlayer: Standing | null;
  mostConsistent: Standing | null;
  photos: EventPhoto[];
  format: "instagram" | "facebook";
  isTeamBattle?: boolean;
  teams?: Team[];
  winningTeam?: Team | null;
  logoUrl?: string | null;
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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
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

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
) {
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

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let truncated = text;
  while (truncated.length > 0 && ctx.measureText(truncated + "...").width > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return truncated + "...";
}

export async function generateResultsCard(data: ResultsCardData): Promise<Blob> {
  const {
    eventName,
    eventDate,
    totalRounds,
    numCourts,
    topThree,
    giantSlayer,
    mostConsistent,
    photos,
    format,
    isTeamBattle,
    teams,
    winningTeam,
    logoUrl,
  } = data;

  const isInstagram = format === "instagram";
  const W = isInstagram ? 1080 : 1200;
  const H = isInstagram ? 1080 : 630;
  const scale = 2;
  const PAD = isInstagram ? 48 : 40;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, "#0055FF");
  bgGrad.addColorStop(0.5, "#0077FF");
  bgGrad.addColorStop(1, "#00AAFF");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.globalAlpha = 0.04;
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  for (let i = -H; i < W + H; i += 60) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.restore();

  let y = PAD;

  const logoImg = logoUrl ? await loadImage(logoUrl) : null;

  if (logoImg) {
    drawImageCover(ctx, logoImg, PAD, y, 64, 64, 14);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    roundRect(ctx, PAD, y, 64, 64, 14);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 10px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("YOUR", PAD + 32, y + 28);
    ctx.fillText("LOGO", PAD + 32, y + 42);
  }

  const textX = PAD + 80;
  ctx.textAlign = "left";

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "600 13px system-ui";
  const dateStr = eventDate ? new Date(eventDate).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "";
  ctx.fillText(dateStr, textX, y + 18);

  ctx.fillStyle = "white";
  ctx.font = "900 28px system-ui";
  const maxTitleW = W - textX - PAD;
  ctx.fillText(truncateText(ctx, eventName.toUpperCase(), maxTitleW), textX, y + 48);

  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "500 13px system-ui";
  const meta = [totalRounds + " Rounds", numCourts ? numCourts + " Courts" : null].filter(Boolean).join("  ·  ");
  ctx.fillText(meta, textX, y + 68);

  y += 88;

  const loadedPhotos: HTMLImageElement[] = [];
  for (const photo of photos.slice(0, 4)) {
    const img = await loadImage(photo.photo_url);
    if (img) loadedPhotos.push(img);
  }

  const photoCount = loadedPhotos.length;
  const photoAreaW = W - PAD * 2;

  if (photoCount > 0) {
    y += 16;
    const photoH = isInstagram ? 200 : 140;
    const gap = 10;

    if (photoCount === 1) {
      drawImageCover(ctx, loadedPhotos[0], PAD, y, photoAreaW, photoH, 14);
    } else if (photoCount === 2) {
      const pw = (photoAreaW - gap) / 2;
      drawImageCover(ctx, loadedPhotos[0], PAD, y, pw, photoH, 14);
      drawImageCover(ctx, loadedPhotos[1], PAD + pw + gap, y, pw, photoH, 14);
    } else if (photoCount === 3) {
      const bigW = (photoAreaW - gap) * 0.55;
      const smallW = photoAreaW - bigW - gap;
      const smallH = (photoH - gap) / 2;
      drawImageCover(ctx, loadedPhotos[0], PAD, y, bigW, photoH, 14);
      drawImageCover(ctx, loadedPhotos[1], PAD + bigW + gap, y, smallW, smallH, 14);
      drawImageCover(ctx, loadedPhotos[2], PAD + bigW + gap, y + smallH + gap, smallW, smallH, 14);
    } else {
      const pw = (photoAreaW - gap) / 2;
      const ph = (photoH - gap) / 2;
      drawImageCover(ctx, loadedPhotos[0], PAD, y, pw, ph, 14);
      drawImageCover(ctx, loadedPhotos[1], PAD + pw + gap, y, pw, ph, 14);
      drawImageCover(ctx, loadedPhotos[2], PAD, y + ph + gap, pw, ph, 14);
      drawImageCover(ctx, loadedPhotos[3], PAD + pw + gap, y + ph + gap, pw, ph, 14);
    }

    y += photoH + 16;
  } else {
    y += 16;
  }

  const champH = isInstagram ? (photoCount > 0 ? 130 : 160) : 110;
  y += 8;

  if (isTeamBattle && teams && teams.length === 2) {
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, PAD, y, photoAreaW, champH, 18);
    ctx.fill();
    ctx.strokeStyle = "rgba(147, 51, 234, 0.8)";
    ctx.lineWidth = 2.5;
    roundRect(ctx, PAD, y, photoAreaW, champH, 18);
    ctx.stroke();

    const midX = W / 2;
    const teamY = y + champH / 2;

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "700 14px system-ui";
    ctx.fillText("TEAM BATTLE RESULTS", midX, y + 24);

    ctx.fillStyle = teams[0].color;
    ctx.font = "900 36px system-ui";
    ctx.fillText(String(teams[0].score), midX - 100, teamY + 14);
    ctx.fillStyle = "white";
    ctx.font = "700 15px system-ui";
    ctx.fillText(teams[0].name, midX - 100, teamY + 36);

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "700 20px system-ui";
    ctx.fillText("vs", midX, teamY + 14);

    ctx.fillStyle = teams[1].color;
    ctx.font = "900 36px system-ui";
    ctx.fillText(String(teams[1].score), midX + 100, teamY + 14);
    ctx.fillStyle = "white";
    ctx.font = "700 15px system-ui";
    ctx.fillText(teams[1].name, midX + 100, teamY + 36);

    if (winningTeam) {
      ctx.fillStyle = winningTeam.color;
      ctx.font = "900 16px system-ui";
      ctx.fillText("WINNER: " + winningTeam.name.toUpperCase(), midX, y + champH - 14);
    }
  } else if (topThree[0]) {
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, PAD, y, photoAreaW, champH, 18);
    ctx.fill();

    const goldGrad = ctx.createLinearGradient(PAD, y, PAD + photoAreaW, y + champH);
    goldGrad.addColorStop(0, "#FFD700");
    goldGrad.addColorStop(1, "#FFA500");
    ctx.strokeStyle = goldGrad;
    ctx.lineWidth = 2.5;
    roundRect(ctx, PAD, y, photoAreaW, champH, 18);
    ctx.stroke();

    const circleX = PAD + 44;
    const circleY = y + champH / 2 - 6;
    const circR = 24;
    const circGrad = ctx.createRadialGradient(circleX, circleY, 0, circleX, circleY, circR);
    circGrad.addColorStop(0, "#FFD700");
    circGrad.addColorStop(1, "#E8A800");
    ctx.fillStyle = circGrad;
    ctx.beginPath();
    ctx.arc(circleX, circleY, circR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "white";
    ctx.font = "900 22px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("1", circleX, circleY + 8);

    const champTextX = PAD + 84;
    ctx.textAlign = "left";

    ctx.fillStyle = "#FFD700";
    ctx.font = "700 12px system-ui";
    ctx.fillText("CHAMPION", champTextX, y + 30);

    ctx.fillStyle = "white";
    ctx.font = "900 28px system-ui";
    ctx.fillText(truncateText(ctx, topThree[0].player_name, photoAreaW - 120), champTextX, y + 60);

    const stats = [
      topThree[0].wins + "W - " + topThree[0].losses + "L",
      topThree[0].win_percentage.toFixed(0) + "% Win Rate",
      "+" + (topThree[0].games_won - topThree[0].games_lost) + " Game Diff",
    ];

    let statX = champTextX;
    ctx.font = "600 14px system-ui";
    stats.forEach((stat, i) => {
      ctx.fillStyle = i === 2 ? "#FFD700" : "rgba(255,255,255,0.9)";
      ctx.fillText(stat, statX, y + 84);
      statX += ctx.measureText(stat).width + 8;
      if (i < stats.length - 1) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fillRect(statX, y + 72, 1.5, 14);
        statX += 10;
      }
    });

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "500 12px system-ui";
    ctx.fillText(
      topThree[0].games_won + " games won · " + topThree[0].games_lost + " games lost",
      champTextX,
      y + 106
    );
  }

  y += champH + 12;

  if (!isTeamBattle && (topThree[1] || topThree[2])) {
    const placeH = 68;
    const placeW = (photoAreaW - 12) / 2;

    const drawPlace = (player: Standing, rank: number, x: number) => {
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      roundRect(ctx, x, y, placeW, placeH, 14);
      ctx.fill();

      const colors: Record<number, [string, string]> = { 2: ["#C0C0C0", "#A0A0A0"], 3: ["#CD7F32", "#A0522D"] };
      const [c1, c2] = colors[rank] || ["#888", "#666"];
      const cx = x + 36;
      const cy = y + placeH / 2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 18);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "white";
      ctx.font = "900 16px system-ui";
      ctx.textAlign = "center";
      ctx.fillText(String(rank), cx, cy + 6);

      ctx.textAlign = "left";
      ctx.fillStyle = c1;
      ctx.font = "600 10px system-ui";
      ctx.fillText(rank === 2 ? "2ND PLACE" : "3RD PLACE", x + 62, y + 26);

      ctx.fillStyle = "white";
      ctx.font = "800 17px system-ui";
      ctx.fillText(truncateText(ctx, player.player_name, placeW - 80), x + 62, y + 48);

      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "500 12px system-ui";
      ctx.fillText(player.wins + "W - " + player.losses + "L", x + 62, y + 64);
    };

    if (topThree[1]) drawPlace(topThree[1], 2, PAD);
    if (topThree[2]) drawPlace(topThree[2], 3, PAD + placeW + 12);

    y += placeH + 12;
  }

  if (!isTeamBattle && (giantSlayer || mostConsistent)) {
    const awardH = 66;
    const awardW = (photoAreaW - 12) / 2;

    const drawAward = (title: string, player: Standing, subtitle: string, color: string, x: number) => {
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      roundRect(ctx, x, y, awardW, awardH, 12);
      ctx.fill();

      ctx.textAlign = "left";
      ctx.fillStyle = color;
      ctx.font = "700 11px system-ui";
      ctx.fillText(title.toUpperCase(), x + 16, y + 22);

      ctx.fillStyle = "white";
      ctx.font = "700 16px system-ui";
      ctx.fillText(truncateText(ctx, player.player_name, awardW - 32), x + 16, y + 44);

      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "500 11px system-ui";
      ctx.fillText(subtitle, x + 16, y + 60);
    };

    if (giantSlayer) {
      drawAward("Giant Slayer", giantSlayer, giantSlayer.wins + " wins with impressive upsets", "#00E5FF", PAD);
    }
    if (mostConsistent) {
      drawAward("Most Consistent", mostConsistent, "+" + (mostConsistent.games_won - mostConsistent.games_lost) + " game differential", "#00FF88", PAD + awardW + 12);
    }

    y += awardH + 12;
  }

  const footerY = H - PAD - 10;

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, footerY - 24);
  ctx.lineTo(W - PAD, footerY - 24);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "500 12px system-ui";
  ctx.fillText("Run your next event at", W / 2, footerY - 4);

  ctx.fillStyle = "white";
  ctx.font = "900 22px system-ui";
  ctx.fillText("directormode.ai", W / 2, footerY + 22);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas export failed"));
      },
      "image/jpeg",
      0.95
    );
  });
}

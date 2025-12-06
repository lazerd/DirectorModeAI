import { toPng } from "html-to-image";

interface Standing {
  player_name: string;
  wins: number;
  losses: number;
  games_won: number;
  games_lost: number;
  win_percentage: number;
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
  topThree: Standing[];
  giantSlayer: Standing | null;
  mostConsistent: Standing | null;
  photos: EventPhoto[];
  format: "instagram" | "facebook";
  isTeamBattle?: boolean;
  teams?: Team[];
  winningTeam?: Team | null;
}

export async function generateResultsCard(data: ResultsCardData): Promise<Blob> {
  const {
    eventName,
    eventDate,
    totalRounds,
    topThree,
    giantSlayer,
    mostConsistent,
    photos,
    format,
    isTeamBattle,
    teams,
    winningTeam,
  } = data;

  const isInstagram = format === "instagram";
  const width = isInstagram ? 1080 : 1200;
  const height = isInstagram ? 1080 : 630;
  const containerPadding = isInstagram ? 40 : 32;
  const sectionGap = isInstagram ? 24 : 16;

  const container = document.createElement("div");
  container.style.width = `${width}px`;
  container.style.height = `${height}px`;
  container.style.position = "fixed";
  container.style.left = "0";
  container.style.top = "0";
  container.style.zIndex = "-9999";
  container.style.visibility = "visible";
  container.style.fontFamily = "system-ui, -apple-system, sans-serif";
  container.style.background = "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)";
  container.style.color = "white";
  container.style.padding = `${containerPadding}px`;
  container.style.boxSizing = "border-box";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = `${sectionGap}px`;
  container.style.overflow = "hidden";

  // Header
  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.justifyContent = "space-between";
  header.style.marginBottom = isInstagram ? "16px" : "12px";

  const logoContainer = document.createElement("div");
  logoContainer.style.display = "flex";
  logoContainer.style.alignItems = "center";
  logoContainer.style.gap = "16px";
  
  const logoImg = document.createElement("img");
  logoImg.src = "";
  logoImg.style.width = isInstagram ? "64px" : "52px";
  logoImg.style.height = isInstagram ? "64px" : "52px";
  logoImg.style.borderRadius = "12px";
  logoImg.style.boxShadow = "0 4px 16px rgba(0,0,0,0.4)";
  logoImg.style.background = "white";
  logoImg.style.padding = "4px";
  logoImg.crossOrigin = "anonymous";
  
  const logoText = document.createElement("div");
  logoText.style.fontSize = isInstagram ? "36px" : "28px";
  logoText.style.fontWeight = "800";
  logoText.style.background = "linear-gradient(135deg, #00f5ff 0%, #0099ff 100%)";
  logoText.style.webkitBackgroundClip = "text";
  logoText.style.backgroundClip = "text";
  logoText.style.webkitTextFillColor = "transparent";
  logoText.style.textShadow = "0 2px 8px rgba(0,149,255,0.3)";
  logoText.textContent = "MixerModeAI";
  
  logoContainer.appendChild(logoImg);
  logoContainer.appendChild(logoText);
  header.appendChild(logoContainer);
  container.appendChild(header);

  // Event title
  const title = document.createElement("div");
  title.style.fontSize = isInstagram ? "48px" : "36px";
  title.style.fontWeight = "900";
  title.style.textAlign = "center";
  title.style.textShadow = "0 2px 12px rgba(0,0,0,0.5)";
  title.style.letterSpacing = "-0.5px";
  title.style.marginBottom = "4px";
  title.textContent = eventName;
  container.appendChild(title);

  // Event details
  const details = document.createElement("div");
  details.style.fontSize = isInstagram ? "20px" : "16px";
  details.style.textAlign = "center";
  details.style.opacity = "0.85";
  details.style.fontWeight = "500";
  details.textContent = `${new Date(eventDate).toLocaleDateString()} • ${totalRounds} Rounds`;
  container.appendChild(details);

  // Photo collage
  if (photos.length > 0) {
    const photoContainer = document.createElement("div");
    photoContainer.style.display = "grid";
    photoContainer.style.gap = isInstagram ? "12px" : "10px";
    photoContainer.style.borderRadius = "16px";
    photoContainer.style.overflow = "hidden";
    photoContainer.style.boxShadow = "0 8px 32px rgba(0,0,0,0.4)";

    if (!isInstagram) {
      if (photos.length === 1) {
        photoContainer.style.gridTemplateColumns = "1fr";
        photoContainer.style.height = "220px";
        photoContainer.style.maxWidth = "350px";
        photoContainer.style.margin = "0 auto";
      } else if (photos.length === 2) {
        photoContainer.style.gridTemplateColumns = "1fr 1fr";
        photoContainer.style.height = "200px";
      } else if (photos.length === 3) {
        photoContainer.style.gridTemplateColumns = "1fr 1fr 1fr";
        photoContainer.style.height = "180px";
      } else if (photos.length === 4) {
        photoContainer.style.gridTemplateColumns = "1fr 1fr";
        photoContainer.style.gridTemplateRows = "1fr 1fr";
        photoContainer.style.height = "260px";
      } else if (photos.length === 5) {
        photoContainer.style.gridTemplateColumns = "repeat(6, 1fr)";
        photoContainer.style.gridTemplateRows = "1fr 1fr";
        photoContainer.style.height = "260px";
      }
    } else {
      photoContainer.style.height = "320px";
      photoContainer.style.minHeight = "320px";
      if (photos.length === 1) {
        photoContainer.style.gridTemplateColumns = "1fr";
        photoContainer.style.maxWidth = "420px";
        photoContainer.style.margin = "0 auto";
        photoContainer.style.aspectRatio = "1 / 1";
        photoContainer.style.height = "auto";
      } else if (photos.length === 2) {
        photoContainer.style.gridTemplateColumns = "1fr 1fr";
      } else if (photos.length === 3) {
        photoContainer.style.gridTemplateColumns = "2fr 1fr";
      } else if (photos.length === 4) {
        photoContainer.style.gridTemplateColumns = "1fr 1fr";
        photoContainer.style.gridTemplateRows = "1fr 1fr";
      } else {
        photoContainer.style.gridTemplateColumns = "repeat(3, 1fr)";
        photoContainer.style.gridTemplateRows = "2fr 1fr";
      }
    }

    for (let i = 0; i < photos.length; i++) {
      const imgWrapper = document.createElement("div");
      imgWrapper.style.width = "100%";
      imgWrapper.style.height = "100%";
      imgWrapper.style.overflow = "hidden";
      imgWrapper.style.borderRadius = "8px";
      imgWrapper.style.position = "relative";
      
      const img = document.createElement("img");
      img.src = photos[i].photo_url;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      img.style.objectPosition = "center";
      img.style.display = "block";
      img.crossOrigin = "anonymous";
      
      imgWrapper.appendChild(img);
      
      if (isInstagram) {
        if (photos.length === 3 && i === 0) {
          imgWrapper.style.gridRow = "1 / -1";
        } else if (photos.length === 5 && i === 0) {
          imgWrapper.style.gridColumn = "1 / -1";
        }
      } else if (photos.length === 5) {
        if (i < 3) {
          imgWrapper.style.gridColumn = `${i * 2 + 1} / span 2`;
          imgWrapper.style.gridRow = "1";
        } else {
          imgWrapper.style.gridColumn = `${(i - 3) * 3 + 2} / span 3`;
          imgWrapper.style.gridRow = "2";
        }
      }
      
      photoContainer.appendChild(imgWrapper);
    }

    container.appendChild(photoContainer);
  }

  // Results section
  const resultsContainer = document.createElement("div");
  resultsContainer.style.flex = "1";
  resultsContainer.style.display = "flex";
  resultsContainer.style.flexDirection = "column";
  resultsContainer.style.gap = isInstagram ? "12px" : "8px";

  // Team Battle Winner OR Individual Champion
  if (isTeamBattle && teams && teams.length === 2) {
    const teamWinner = document.createElement("div");
    teamWinner.style.background = "linear-gradient(135deg, rgba(147, 51, 234, 0.25) 0%, rgba(79, 70, 229, 0.15) 100%)";
    teamWinner.style.border = "3px solid rgba(147, 51, 234, 0.6)";
    teamWinner.style.borderRadius = "16px";
    teamWinner.style.padding = isInstagram ? "20px" : "16px";
    teamWinner.style.boxShadow = "0 4px 20px rgba(147, 51, 234, 0.3)";
    
    const team1 = teams[0];
    const team2 = teams[1];
    
    if (winningTeam) {
      teamWinner.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: ${isInstagram ? '24px' : '20px'}; margin-bottom: 12px; opacity: 0.9;">
            ⚔️ Team Battle Results ⚔️
          </div>
          <div style="display: flex; justify-content: center; align-items: center; gap: 20px; margin-bottom: 16px;">
            <div style="text-align: center;">
              <div style="font-size: ${isInstagram ? '18px' : '15px'}; font-weight: 700;">${team1.name}</div>
              <div style="font-size: ${isInstagram ? '32px' : '26px'}; font-weight: 900; color: ${team1.color};">${team1.score}</div>
            </div>
            <div style="font-size: ${isInstagram ? '24px' : '20px'}; opacity: 0.5;">vs</div>
            <div style="text-align: center;">
              <div style="font-size: ${isInstagram ? '18px' : '15px'}; font-weight: 700;">${team2.name}</div>
              <div style="font-size: ${isInstagram ? '32px' : '26px'}; font-weight: 900; color: ${team2.color};">${team2.score}</div>
            </div>
          </div>
          <div style="font-size: ${isInstagram ? '28px' : '22px'}; font-weight: 900;">
            🏆 Winner: <span style="color: ${winningTeam.color};">${winningTeam.name}</span> 🏆
          </div>
        </div>
      `;
    } else {
      teamWinner.innerHTML = `
        <div style="text-align: center;">
          <div style="font-size: ${isInstagram ? '24px' : '20px'}; margin-bottom: 12px; opacity: 0.9;">
            ⚔️ Team Battle Results ⚔️
          </div>
          <div style="display: flex; justify-content: center; align-items: center; gap: 20px; margin-bottom: 16px;">
            <div style="text-align: center;">
              <div style="font-size: ${isInstagram ? '18px' : '15px'}; font-weight: 700;">${team1.name}</div>
              <div style="font-size: ${isInstagram ? '32px' : '26px'}; font-weight: 900; color: ${team1.color};">${team1.score}</div>
            </div>
            <div style="font-size: ${isInstagram ? '24px' : '20px'}; opacity: 0.5;">vs</div>
            <div style="text-align: center;">
              <div style="font-size: ${isInstagram ? '18px' : '15px'}; font-weight: 700;">${team2.name}</div>
              <div style="font-size: ${isInstagram ? '32px' : '26px'}; font-weight: 900; color: ${team2.color};">${team2.score}</div>
            </div>
          </div>
          <div style="font-size: ${isInstagram ? '28px' : '22px'}; font-weight: 900;">
            🤝 It's a TIE! 🤝
          </div>
        </div>
      `;
    }
    resultsContainer.appendChild(teamWinner);
  } else if (topThree[0]) {
    const champion = document.createElement("div");
    champion.style.background = "linear-gradient(135deg, rgba(255, 215, 0, 0.25) 0%, rgba(255, 180, 0, 0.15) 100%)";
    champion.style.border = "3px solid rgba(255, 215, 0, 0.6)";
    champion.style.borderRadius = "16px";
    champion.style.padding = isInstagram ? "20px" : "16px";
    champion.style.boxShadow = "0 4px 20px rgba(255, 215, 0, 0.3)";
    champion.innerHTML = `
      <div style="font-size: ${isInstagram ? '28px' : '22px'}; font-weight: 900; margin-bottom: 6px; display: flex; align-items: center; gap: 12px;">
        <span style="font-size: ${isInstagram ? '36px' : '28px'};">🏆</span>
        <span>Champion: ${topThree[0].player_name}</span>
      </div>
      <div style="font-size: ${isInstagram ? '18px' : '15px'}; opacity: 0.95; font-weight: 600;">
        ${topThree[0].wins}W-${topThree[0].losses}L • ${topThree[0].win_percentage.toFixed(0)}% Win Rate
      </div>
    `;
    resultsContainer.appendChild(champion);
  }

  // 2nd and 3rd place (only for non-team battles)
  if (!isTeamBattle) {
    const otherPlaces = document.createElement("div");
    otherPlaces.style.display = "grid";
    otherPlaces.style.gridTemplateColumns = "1fr 1fr";
    otherPlaces.style.gap = "12px";

    if (topThree[1]) {
      const second = document.createElement("div");
      second.style.background = "linear-gradient(135deg, rgba(192, 192, 192, 0.3) 0%, rgba(169, 169, 169, 0.2) 100%)";
      second.style.border = "2px solid rgba(192, 192, 192, 0.6)";
      second.style.borderRadius = "14px";
      second.style.padding = isInstagram ? "14px" : "12px";
      second.innerHTML = `
        <div style="font-size: ${isInstagram ? '20px' : '18px'}; font-weight: 800; margin-bottom: 4px;">
          🥈 ${topThree[1].player_name}
        </div>
        <div style="font-size: ${isInstagram ? '15px' : '13px'}; opacity: 0.9; font-weight: 500;">
          ${topThree[1].wins}W-${topThree[1].losses}L
        </div>
      `;
      otherPlaces.appendChild(second);
    }

    if (topThree[2]) {
      const third = document.createElement("div");
      third.style.background = "linear-gradient(135deg, rgba(205, 127, 50, 0.3) 0%, rgba(184, 115, 51, 0.2) 100%)";
      third.style.border = "2px solid rgba(205, 127, 50, 0.6)";
      third.style.borderRadius = "14px";
      third.style.padding = isInstagram ? "14px" : "12px";
      third.innerHTML = `
        <div style="font-size: ${isInstagram ? '20px' : '18px'}; font-weight: 800; margin-bottom: 4px;">
          🥉 ${topThree[2].player_name}
        </div>
        <div style="font-size: ${isInstagram ? '15px' : '13px'}; opacity: 0.9; font-weight: 500;">
          ${topThree[2].wins}W-${topThree[2].losses}L
        </div>
      `;
      otherPlaces.appendChild(third);
    }

    resultsContainer.appendChild(otherPlaces);

    // Awards
    const awards = document.createElement("div");
    awards.style.display = "grid";
    awards.style.gridTemplateColumns = "1fr 1fr";
    awards.style.gap = "12px";

    if (giantSlayer) {
      const slayer = document.createElement("div");
      slayer.style.background = "linear-gradient(135deg, rgba(0, 245, 255, 0.15) 0%, rgba(0, 153, 255, 0.1) 100%)";
      slayer.style.border = "2px solid rgba(0, 245, 255, 0.3)";
      slayer.style.borderRadius = "12px";
      slayer.style.padding = isInstagram ? "12px" : "10px";
      slayer.innerHTML = `
        <div style="font-size: ${isInstagram ? '18px' : '15px'}; font-weight: 800; margin-bottom: 2px;">
          🎯 Giant Slayer
        </div>
        <div style="font-size: ${isInstagram ? '15px' : '13px'}; opacity: 0.9; font-weight: 500;">
          ${giantSlayer.player_name}
        </div>
      `;
      awards.appendChild(slayer);
    }

    if (mostConsistent) {
      const consistent = document.createElement("div");
      consistent.style.background = "linear-gradient(135deg, rgba(0, 245, 255, 0.15) 0%, rgba(0, 153, 255, 0.1) 100%)";
      consistent.style.border = "2px solid rgba(0, 245, 255, 0.3)";
      consistent.style.borderRadius = "12px";
      consistent.style.padding = isInstagram ? "12px" : "10px";
      consistent.innerHTML = `
        <div style="font-size: ${isInstagram ? '18px' : '15px'}; font-weight: 800; margin-bottom: 2px;">
          📈 Most Consistent
        </div>
        <div style="font-size: ${isInstagram ? '15px' : '13px'}; opacity: 0.9; font-weight: 500;">
          ${mostConsistent.player_name}
        </div>
      `;
      awards.appendChild(consistent);
    }

    resultsContainer.appendChild(awards);
  }

  container.appendChild(resultsContainer);

  // Footer
  const footer = document.createElement("div");
  footer.style.borderTop = "2px solid rgba(0, 245, 255, 0.3)";
  footer.style.paddingTop = isInstagram ? "20px" : "14px";
  footer.style.textAlign = "center";
  footer.style.marginTop = "auto";
  footer.innerHTML = `
    <div style="font-size: ${isInstagram ? '16px' : '13px'}; font-weight: 600; margin-bottom: 6px; opacity: 0.8;">
      Run your next pickleball or tennis event at
    </div>
    <div style="
      font-size: ${isInstagram ? '26px' : '20px'}; 
      font-weight: 900; 
      background: linear-gradient(135deg, #00f5ff 0%, #0099ff 100%);
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: 0.5px;
    ">
      mixermodeai.com
    </div>
  `;
  container.appendChild(footer);

  document.body.appendChild(container);

  try {
    const images = container.querySelectorAll("img");
    await Promise.all(
      Array.from(images).map(
        (img, index) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              resolve();
            } else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
              setTimeout(() => resolve(), 5000);
            }
          })
      )
    );

    await new Promise(resolve => setTimeout(resolve, 800));

    const dataUrl = await toPng(container, {
      quality: 0.98,
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#1a1a2e",
    });

    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return blob;
  } finally {
    document.body.removeChild(container);
  }
}

import { toPng } from "html-to-image";
// import logo from "@/assets/logo.png"; // TODO: Add logo asset

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

interface ResultsCardData {
  eventName: string;
  eventDate: string;
  totalRounds: number;
  topThree: Standing[];
  giantSlayer: Standing | null;
  mostConsistent: Standing | null;
  photos: EventPhoto[];
  format: "instagram" | "facebook";
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
  } = data;

  const isInstagram = format === "instagram";
  const width = isInstagram ? 1080 : 1200;
  const height = isInstagram ? 1080 : 630;
  const containerPadding = isInstagram ? 40 : 32;
  const sectionGap = isInstagram ? 24 : 16;

  // Create a container element
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

  // Header with logo and event info
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
  logoImg.src = ""; // TODO: Add logo
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

    // Perfect layouts for each photo count
    if (!isInstagram) {
      // FACEBOOK FORMAT - Optimized for 1200x630 with generous spacing
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
      // INSTAGRAM FORMAT
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
      img.style.transition = "transform 0.3s ease";
      img.crossOrigin = "anonymous";
      
      imgWrapper.appendChild(img);
      
      // Special grid positioning
      if (isInstagram) {
        if (photos.length === 3 && i === 0) {
          imgWrapper.style.gridRow = "1 / -1";
        } else if (photos.length === 5 && i === 0) {
          imgWrapper.style.gridColumn = "1 / -1";
        }
      } else if (photos.length === 5) {
        // Facebook 5-photo layout: 3 on top, 2 centered on bottom
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

  // Champion (larger)
  if (topThree[0]) {
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
        ${topThree[0].wins}W-${topThree[0].losses}L • ${topThree[0].win_percentage}% Win Rate
      </div>
    `;
    resultsContainer.appendChild(champion);
  }

  // 2nd and 3rd place
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
    second.style.boxShadow = "0 2px 12px rgba(192, 192, 192, 0.2)";
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
    third.style.boxShadow = "0 2px 12px rgba(205, 127, 50, 0.2)";
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

  // Special awards
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
  container.appendChild(resultsContainer);

  // Footer branding
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

  // Add to DOM temporarily
  document.body.appendChild(container);
  console.log("[ResultsCard] Container added to DOM");

  try {
    // Wait for images to load with better error handling
    const images = container.querySelectorAll("img");
    console.log(`[ResultsCard] Loading ${images.length} images...`);
    
    await Promise.all(
      Array.from(images).map(
        (img, index) =>
          new Promise<void>((resolve) => {
            if (img.complete) {
              console.log(`[ResultsCard] Image ${index} already loaded`);
              resolve();
            } else {
              img.onload = () => {
                console.log(`[ResultsCard] Image ${index} loaded successfully`);
                resolve();
              };
              img.onerror = (error) => {
                console.warn(`[ResultsCard] Image ${index} failed to load:`, error);
                // Continue anyway, don't block the capture
                resolve();
              };
              // Timeout fallback
              setTimeout(() => {
                console.warn(`[ResultsCard] Image ${index} load timeout, continuing...`);
                resolve();
              }, 5000);
            }
          })
      )
    );

    console.log("[ResultsCard] All images processed");

    // Critical: Wait for browser to complete rendering
    // This allows styles and layout to fully apply before capture
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log("[ResultsCard] Render delay complete, capturing...");

    // Generate image with enhanced options
    const dataUrl = await toPng(container, {
      quality: 0.98,
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: "#1a1a2e",
      style: {
        transform: "scale(1)",
        transformOrigin: "top left"
      }
    });

    console.log("[ResultsCard] Image captured successfully");

    // Convert to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    
    console.log(`[ResultsCard] Blob created: ${blob.size} bytes`);
    return blob;
  } catch (error) {
    console.error("[ResultsCard] Generation failed:", error);
    throw error;
  } finally {
    // Clean up
    document.body.removeChild(container);
    console.log("[ResultsCard] Container removed from DOM");
  }
}

/**
 * Shrink a phone photo in the browser before it is uploaded.
 *
 * Vercel refuses any request body over ~4.5 MB with a plain-text "Request
 * Entity Too Large", and a modern phone photo is 3–8 MB before base64 adds a
 * third on top. Darrin hit exactly that photographing a Fall B2/B3 scorecard
 * on 2026-09-10: the page tried to parse the platform's text as JSON and
 * showed `Unexpected token 'R', "Request En"...`.
 *
 * Handwriting reads fine at 1600px on the long edge, which lands around
 * 200–600 KB as JPEG — well inside the limit, and faster on court-side 4G.
 *
 * Client-only: uses canvas.
 */

export type ShrunkImage = { data: string; mediaType: 'image/jpeg'; width: number; height: number };

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  // createImageBitmap honours the photo's EXIF rotation, so a portrait shot
  // of a scorecard doesn't arrive sideways.
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
    } catch {
      /* fall through to <img>, which some browsers decode more formats with */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('decode'));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      done: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      'That photo could not be opened. Try again with the camera, or send a screenshot of the scorecard instead.',
    );
  }
}

export async function shrinkImage(file: File, maxEdge = 1600, quality = 0.85): Promise<ShrunkImage> {
  const img = await decode(file);
  try {
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the photo for upload.');

    // JPEG has no transparency; without a fill a PNG's clear areas turn black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.source, 0, 0, width, height);

    const data = canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? '';
    if (!data) throw new Error('This browser could not prepare the photo for upload.');
    return { data, mediaType: 'image/jpeg', width, height };
  } finally {
    img.done();
  }
}

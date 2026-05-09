const API_KEY = process.env.PIXABAY_API_KEY;

export interface PixabayTrack {
  id: number;
  title: string;
  user: string;
  duration: number;
  audioUrl: string;
  previewUrl: string;
  tags: string[];
}

interface PixabayApiHit {
  id: number;
  title?: string;
  name?: string;
  user: string;
  duration: number;
  audio?: string;
  audio_url?: string;
  preview?: string;
  tags?: string;
}

export async function searchPixabayMusic(query: string, opts: { perPage?: number; category?: string } = {}): Promise<PixabayTrack[]> {
  if (!API_KEY) {
    throw new Error('PIXABAY_API_KEY not configured');
  }
  const params = new URLSearchParams({
    key: API_KEY,
    q: query,
    per_page: String(opts.perPage ?? 30),
    safesearch: 'true',
  });
  if (opts.category) params.set('category', opts.category);

  const res = await fetch(`https://pixabay.com/api/music/?${params.toString()}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`Pixabay ${res.status}`);
  }
  const data = await res.json();
  const hits: PixabayApiHit[] = data.hits || [];
  return hits.map((h) => ({
    id: h.id,
    title: h.title || h.name || 'Untitled',
    user: h.user,
    duration: h.duration,
    audioUrl: h.audio_url || h.audio || '',
    previewUrl: h.preview || h.audio_url || h.audio || '',
    tags: (h.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
  }));
}

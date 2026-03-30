import { createClient } from '@/lib/supabase/client';

const PRODUCT_MAP: Record<string, string> = {
  '/mixer': 'mixer',
  '/lessons': 'lessons',
  '/stringing': 'stringing',
  '/courtconnect': 'courtconnect',
  '/vault': 'vault',
  '/book': 'lessons',
  '/event': 'mixer',
  '/coach': 'lessons',
  '/find-coach': 'lessons',
  '/client': 'lessons',
};

export function getProductFromPath(path: string): string | null {
  for (const [prefix, product] of Object.entries(PRODUCT_MAP)) {
    if (path.startsWith(prefix)) return product;
  }
  return null;
}

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return '';
  const key = 'clubmode_session_id';
  let sessionId = sessionStorage.getItem(key);
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem(key, sessionId);
  }
  return sessionId;
}

async function getCurrentUserId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

let cachedUserId: string | null = null;
let userIdFetched = false;

export function trackEvent(
  eventType: 'page_view' | 'feature_use' | 'session_start' | 'session_end',
  eventName: string,
  product?: string | null,
  metadata?: Record<string, unknown>
): void {
  if (typeof window === 'undefined') return;

  const sessionId = getOrCreateSessionId();

  const send = (userId: string | null) => {
    fetch('/api/admin/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: eventType,
        event_name: eventName,
        product: product ?? getProductFromPath(window.location.pathname),
        user_id: userId,
        session_id: sessionId,
        metadata: metadata ?? {},
      }),
    }).catch(() => {
      // fire-and-forget
    });
  };

  if (userIdFetched) {
    send(cachedUserId);
  } else {
    getCurrentUserId().then((uid) => {
      cachedUserId = uid;
      userIdFetched = true;
      send(uid);
    });
  }
}

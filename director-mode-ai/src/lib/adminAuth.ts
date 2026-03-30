import { cookies } from 'next/headers';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'masterdirector!';
const COOKIE_NAME = 'clubmode_admin';
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

// In-memory token store (resets on deploy, which is fine for admin sessions)
export const validTokens = new Set<string>();

export function checkPassword(password: string): boolean {
  return password === ADMIN_PASSWORD;
}

export function createAdminToken(): string {
  const token = generateToken();
  validTokens.add(token);
  return token;
}

export async function setAdminCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  });
}

export async function clearAdminCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (token) validTokens.delete(token);
  cookieStore.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return Boolean(token && validTokens.has(token));
}

// Also accept the legacy X-Admin-Key header as fallback
export async function isAdminRequest(request: Request): Promise<boolean> {
  // Check cookie first
  if (await isAdminAuthenticated()) return true;
  // Fallback: check header (for backward compat during transition)
  const headerKey = request.headers.get('X-Admin-Key');
  return headerKey === ADMIN_PASSWORD;
}

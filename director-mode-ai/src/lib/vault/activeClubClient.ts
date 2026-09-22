/**
 * The club a browser page is working in.
 *
 * PlayerVault rows belong to a club (vault_belongs_to_a_club.sql), so every
 * client-side read and write has to say which one. Server code asks
 * resolveActiveClub(); a client component asks this, which is the same answer
 * over /api/me/active-club — the endpoint the club switcher already uses.
 *
 * Returns null when the person runs no club. A caller that gets null must show
 * nothing rather than fall back to "everything this director ever entered",
 * which is the behaviour club scoping exists to end.
 */
export async function activeClubId(): Promise<string | null> {
  try {
    const res = await fetch('/api/me/active-club');
    if (!res.ok) return null;
    const json = (await res.json()) as { active?: { id?: string } | null };
    return json.active?.id ?? null;
  } catch {
    return null;
  }
}

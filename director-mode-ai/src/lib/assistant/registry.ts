import type { BoundPack, DomainPack } from './framework';
import { bindPack } from './framework';
import { jttPack } from './packs/jtt';
import { benchmarksPack } from './packs/benchmarks';
import { calendarPack } from './packs/calendar';

// The set of domain packs the assistant can draw on. To give a new page
// conversational actions, write a pack (src/lib/assistant/packs/<domain>.ts)
// and add it here — the chat route needs no changes.
const PROVIDERS: DomainPack<any>[] = [
  jttPack,
  benchmarksPack,
  calendarPack,
];

/**
 * Resolve every pack that is available for this user on this page, each bound to
 * its own context. The route unions their tool schemas and appends each pack's
 * actionsPrompt. A pack whose resolve() returns null (not applicable / no
 * permission) is simply skipped; a pack that throws is skipped too.
 */
export async function resolvePacks(userId: string, page: string | undefined): Promise<BoundPack[]> {
  const bound: BoundPack[] = [];
  for (const p of PROVIDERS) {
    let ctx: unknown = null;
    try { ctx = await p.resolve(userId, page); } catch { ctx = null; }
    if (ctx == null) continue;
    bound.push(bindPack(p, ctx));
  }
  return bound;
}

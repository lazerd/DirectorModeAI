import { getSupabaseAdmin } from '@/lib/supabase/admin';

/*
 * The club-computer bridge (11/25/26). Some work needs the director's own logged-in tools on
 * their PC: ClubSpot (no API, only the signed-in dashboard), and the reimbursement scripts that
 * fill the form and email the accountant. ClubMode queues a job here; the worker on that PC
 * (court-booker/clubmode-bridge.js) claims it, runs it, and posts the result back.
 *
 * Callers can wait a little for the answer (a text reply feels instant if the PC is on), and
 * otherwise get "queued": the worker's result is texted to the line when it lands.
 */

export type BridgeKind = 'clubspot_day' | 'clubspot_block' | 'clubspot_events' | 'clubspot_event_billing' | 'clubspot_find_member' | 'clubspot_tab_charge' | 'reimburse';
export interface BridgeJob {
  id: string; kind: BridgeKind; status: 'queued' | 'running' | 'done' | 'failed';
  input: Record<string, unknown>; result: Record<string, unknown> | null; error: string | null;
  line_id: string | null; user_id: string | null; club_id: string | null; created_at: string;
}

/** The club whose PC runs the ClubSpot bridge (Sleepy Hollow). Others don't get the ClubSpot tools. */
export const clubspotClubId = () => process.env.CLUBSPOT_BRIDGE_CLUB_ID || 'c437bf37-1ea2-4dc1-9250-11402f377726';

export async function queueJob(j: { kind: BridgeKind; input: Record<string, unknown>; clubId?: string | null; userId?: string | null; lineId?: string | null }): Promise<BridgeJob> {
  const { data, error } = await getSupabaseAdmin()
    .from('bridge_jobs')
    .insert({ kind: j.kind, input: j.input, club_id: j.clubId ?? null, user_id: j.userId ?? null, line_id: j.lineId ?? null })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'could not queue');
  return data as BridgeJob;
}

/** Wait up to `ms` for a job to finish. Returns the job as it stands. */
export async function waitForJob(id: string, ms = 40_000): Promise<BridgeJob> {
  const db = getSupabaseAdmin();
  const until = Date.now() + ms;
  let job: BridgeJob | null = null;
  while (Date.now() < until) {
    const { data } = await db.from('bridge_jobs').select('*').eq('id', id).maybeSingle();
    job = data as BridgeJob | null;
    if (job && (job.status === 'done' || job.status === 'failed')) return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return job as BridgeJob;
}

/** Is the worker alive? (It checks in on every poll.) */
export async function bridgeOnline(): Promise<boolean> {
  const { data } = await getSupabaseAdmin().from('bridge_workers').select('seen_at').eq('club_id', clubspotClubId()).maybeSingle();
  const at = (data as { seen_at?: string } | null)?.seen_at;
  return !!at && Date.now() - new Date(at).getTime() < 3 * 60_000;
}

/** Wait briefly; if the PC is slow or off, the job stays queued and its result is texted later. */
export async function runOnBridge(j: Parameters<typeof queueJob>[0], waitMs = 40_000) {
  const job = await queueJob(j);
  const done = await waitForJob(job.id, waitMs);
  if (done.status === 'done') return { ok: true as const, result: done.result ?? {} };
  if (done.status === 'failed') return { ok: false as const, error: done.error || 'The club computer hit an error.' };
  // Too slow to answer inline: text the result to the director when the PC finishes.
  await getSupabaseAdmin().from('bridge_jobs').update({ input: { ...(job.input ?? {}), notify: true } }).eq('id', job.id).in('status', ['queued', 'running']);
  return { ok: true as const, queued: true, jobId: job.id, online: await bridgeOnline() };
}

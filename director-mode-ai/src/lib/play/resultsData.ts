import 'server-only';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import type { PlayDraft, PlayRsvp, PlayState, PlayStatus } from './core';

export type ResultsEvent = PlayDraft & { code: string; status: PlayStatus; state: PlayState; created_at: string; rsvps: PlayRsvp[] };

/**
 * A strictly read-only load for the print sheet, results image and CSV.
 * (Not view(): that can roll a weekly series forward, which writes rows.)
 */
export async function loadResults(c: string): Promise<ResultsEvent | null> {
  const code = c.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!code) return null;
  const db = getSupabaseAdmin();
  const { data: row } = await db.from('play_events').select('*').eq('code', code).maybeSingle();
  if (!row) return null;
  const { data: rs } = await db.from('play_rsvps').select('id,name,gender,level,level_num,team,status,is_host,created_at,checked_in_at').eq('event_id', row.id).order('created_at');
  const { host_key, id, parent_id, source_text, ...pub } = row as Record<string, unknown>;
  void host_key; void id; void parent_id; void source_text;
  return {
    ...(pub as unknown as Omit<ResultsEvent, 'rsvps'>),
    state: ((pub as { state?: PlayState }).state ?? {}) as PlayState,
    rsvps: ((rs ?? []) as PlayRsvp[]).filter((r) => r.status !== 'out'),
  };
}

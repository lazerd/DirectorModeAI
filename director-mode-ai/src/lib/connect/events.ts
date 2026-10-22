/**
 * Application stage log (connect_application_events). Every route that changes an
 * application's stage writes here; the placement audit record reads it back.
 * Logging never breaks the move itself: failures are reported, not thrown.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export type ActorRole = 'club' | 'candidate' | 'platform' | 'system';

export type StageEvent = {
  application_id: string;
  from_stage: string | null;
  to_stage: string;
  actor_id?: string | null;
  actor_role: ActorRole;
  note?: string | null;
  at?: string;
};

export async function logStageEvents(events: StageEvent[]): Promise<void> {
  if (!events.length) return;
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from('connect_application_events')
    .insert(events.map((e) => ({ ...e, actor_id: e.actor_id ?? null, note: e.note ?? null, at: e.at ?? now })));
  if (error) console.error('[connect/events] stage log failed', error.message, events.map((e) => e.application_id));
}

export const logStageEvent = (e: StageEvent) => logStageEvents([e]);

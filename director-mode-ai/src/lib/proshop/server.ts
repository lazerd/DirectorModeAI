import { createClient } from '@/lib/supabase/server';
import { resolveClubCtx, MANAGER_ROLES, type ClubCtx } from '@/lib/assistant/clubContext';
import { STAFF_IDS } from './staff';

/** The signed-in person and the club they're running, or why not. */
export async function proshopCaller(): Promise<
  { ok: true; ctx: ClubCtx; email: string | null } | { ok: false; status: number; error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, status: 401, error: 'Sign in to ClubMode to open your Pro Shop.' };
  const ctx = await resolveClubCtx(user.id);
  if (!ctx) return { ok: false, status: 403, error: 'Your Pro Shop opens once you run a club in ClubMode.' };
  return { ok: true, ctx, email: user.email ?? null };
}

export const canDecide = (ctx: ClubCtx) => MANAGER_ROLES.has(ctx.role);

export type TaskStatus = 'waiting' | 'proposed' | 'approved' | 'doing' | 'done' | 'declined';

/** Shape the page reads (mirrors the old artifact board, so the page code barely changes). */
export interface TaskOut {
  id: string; agent: string; text: string; status: TaskStatus; by: 'director' | 'staff';
  detail?: string | null; money?: string | null; note?: string | null; play?: string | null; run?: string | null;
  at: string; decidedAt?: string | null;
}

export function taskOut(r: Record<string, any>): TaskOut {
  return {
    id: r.id, agent: r.agent, text: r.text, status: r.status, by: r.source,
    detail: r.detail, money: r.money, note: r.note, play: r.play, run: r.run,
    at: r.created_at, decidedAt: r.decided_at,
  };
}

/** Add an order for one staff member. Text is trimmed and capped; agent must be real staff. */
export async function addOrder(
  ctx: ClubCtx,
  input: { agent: string; text: string; play?: string | null; run?: string | null },
): Promise<TaskOut> {
  const agent = STAFF_IDS.has(input.agent) ? input.agent : 'frontdesk';
  const text = String(input.text ?? '').trim().slice(0, 600);
  if (!text) throw new Error('empty order');
  const { data, error } = await ctx.db
    .from('proshop_tasks')
    .insert({
      club_id: ctx.clubId, agent, text, status: 'waiting', source: 'director', created_by: ctx.userId,
      play: input.play ? String(input.play).slice(0, 80) : null,
      run: input.run ? String(input.run).slice(0, 40) : null,
    })
    .select('*')
    .single();
  if (error || !data) throw new Error(error?.message || 'insert failed');
  return taskOut(data);
}

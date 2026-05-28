/**
 * CourtSheet AI — signup management.
 *
 * Powers the "looking for 3 more for doubles", "clinic with 6 slots", and
 * "social, RSVP if you can" surfaces. All three are the same mechanism:
 * a reservation with signups_open=true and signups_capacity=N.
 *
 * Status transitions:
 *   - signup(): inserts as 'requested' or 'waitlist' based on capacity
 *   - cancelSignup(): flips to 'cancelled', then promotes the head of the
 *     waitlist into the freed slot (FIFO by signed_up_at)
 *   - openForSignups(): host opts a reservation in/out
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Reservation, Signup } from './types';

export interface SignupContext {
  db: SupabaseClient<any, 'public', any>;
  actor_user_id: string | null; // null for fully anonymous public signups
}

export interface SignupIdentity {
  user_id?: string;
  vault_player_id?: string;
  guest_name?: string;
  guest_email?: string;
}

export interface SignupResult {
  signup: Signup;
  status: Signup['status'];
  position?: number; // 1-based position if waitlisted
}

/** Opt a reservation into accepting signups (or close it). */
export async function openForSignups(
  reservation_id: string,
  args: { open: boolean; capacity?: number; pitch?: string },
  ctx: SignupContext
): Promise<Reservation> {
  const updates: Partial<Reservation> = { signups_open: args.open };
  if (args.capacity !== undefined) updates.signups_capacity = args.capacity;
  if (args.pitch !== undefined) updates.signups_pitch = args.pitch;
  const { data, error } = await ctx.db
    .from('reservations')
    .update(updates)
    .eq('id', reservation_id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Reservation;
}

/** Sign up for an open reservation. Returns the row and whether you're confirmed or waitlisted. */
export async function signup(
  reservation_id: string,
  identity: SignupIdentity,
  note: string | null,
  ctx: SignupContext
): Promise<SignupResult> {
  if (
    !identity.user_id &&
    !identity.vault_player_id &&
    !(identity.guest_name && identity.guest_email)
  ) {
    throw new Error('signup() requires user_id, vault_player_id, or guest_name+guest_email');
  }

  const { data: r, error: rErr } = await ctx.db
    .from('reservations')
    .select('id, signups_open, signups_capacity, status')
    .eq('id', reservation_id)
    .maybeSingle();
  if (rErr) throw new Error(rErr.message);
  if (!r) throw new Error('Reservation not found');
  if (r.status !== 'confirmed') throw new Error('Reservation is not active');
  if (!r.signups_open) throw new Error('Signups are closed for this reservation');

  const confirmed = await countSignups(ctx.db, reservation_id, ['requested', 'confirmed']);
  const capacityFull =
    r.signups_capacity !== null && confirmed >= r.signups_capacity;

  const status: Signup['status'] = capacityFull ? 'waitlist' : 'requested';

  const { data, error } = await ctx.db
    .from('reservation_signups')
    .insert({
      reservation_id,
      user_id: identity.user_id ?? null,
      vault_player_id: identity.vault_player_id ?? null,
      guest_name: identity.guest_name ?? null,
      guest_email: identity.guest_email ?? null,
      note,
      status,
    })
    .select('*')
    .single();

  if (error) throw new Error(error.message);

  let position: number | undefined;
  if (status === 'waitlist') {
    position = await waitlistPosition(ctx.db, reservation_id, (data as Signup).signed_up_at);
  }

  return { signup: data as Signup, status, position };
}

/**
 * Cancel a signup and promote the head of the waitlist if capacity opens.
 */
export async function cancelSignup(
  signup_id: string,
  ctx: SignupContext
): Promise<{ cancelled: Signup; promoted: Signup | null }> {
  const { data: row, error } = await ctx.db
    .from('reservation_signups')
    .update({ status: 'cancelled' })
    .eq('id', signup_id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  const cancelled = row as Signup;

  // If the cancelled signup was confirmed/requested (i.e. took a slot),
  // promote the head of the waitlist.
  let promoted: Signup | null = null;
  if (cancelled.status === 'cancelled') {
    const { data: head } = await ctx.db
      .from('reservation_signups')
      .select('*')
      .eq('reservation_id', cancelled.reservation_id)
      .eq('status', 'waitlist')
      .order('signed_up_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (head) {
      const { data: promotedRow } = await ctx.db
        .from('reservation_signups')
        .update({ status: 'requested' })
        .eq('id', (head as Signup).id)
        .select('*')
        .single();
      promoted = (promotedRow ?? null) as Signup | null;
    }
  }

  return { cancelled, promoted };
}

/** Staff helper: explicitly promote a waitlist row to confirmed. */
export async function confirmSignup(
  signup_id: string,
  ctx: SignupContext
): Promise<Signup> {
  const { data, error } = await ctx.db
    .from('reservation_signups')
    .update({ status: 'confirmed' })
    .eq('id', signup_id)
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as Signup;
}

async function countSignups(
  db: SupabaseClient<any, 'public', any>,
  reservation_id: string,
  statuses: Array<Signup['status']>
): Promise<number> {
  const { count } = await db
    .from('reservation_signups')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservation_id)
    .in('status', statuses);
  return count ?? 0;
}

async function waitlistPosition(
  db: SupabaseClient<any, 'public', any>,
  reservation_id: string,
  signed_up_at: string
): Promise<number> {
  const { count } = await db
    .from('reservation_signups')
    .select('id', { count: 'exact', head: true })
    .eq('reservation_id', reservation_id)
    .eq('status', 'waitlist')
    .lte('signed_up_at', signed_up_at);
  return count ?? 1;
}

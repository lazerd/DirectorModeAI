/**
 * Round-4 doubles for one quad flight: create it, place it, keep it honest.
 *
 * Both scoring paths call this after every score — the public token route
 * (parents/players) and the director's Matches tab — so there is exactly one
 * definition of "the doubles is ready". It always re-reads the flight from the
 * database: pairing off the caller's in-memory copy is how a director-entered
 * final singles score used to get paired WITHOUT that score counted.
 *
 * - All six singles scored, no doubles yet → insert it (1+4 vs 2+3), on the
 *   flight's first court, one round after round 3 starts. The auto-scheduler
 *   runs before round 4 exists, so without this it had no court or time.
 * - Doubles exists but isn't scored, and a corrected singles score changed the
 *   ladder → re-pair it in place (keeps its court, time and scoring token).
 * - Doubles already scored → leave it. Re-pairing a played match would
 *   rewrite history; `stalePairing` tells the caller to flag it instead.
 *
 * A partial unique index (one doubles per flight) makes the insert safe when
 * two parents submit the last two round-3 scores at the same moment.
 */

import {
  addMinutesToTime,
  buildQuadDoublesRound,
  computeFlightStandings,
  type QuadMatchView,
} from './quads';

export type DoublesSyncResult =
  | { action: 'waiting' }
  | { action: 'created' | 'repaired' | 'unchanged'; stalePairing?: false }
  | { action: 'locked'; stalePairing: boolean };

export async function syncQuadDoublesRound(client: any, flightId: string): Promise<DoublesSyncResult> {
  const [{ data: matchRows }, { data: entryRows }, { data: flight }] = await Promise.all([
    client.from('quad_matches').select('*').eq('flight_id', flightId),
    client.from('quad_entries').select('id, flight_seed').eq('flight_id', flightId),
    client
      .from('quad_flights')
      .select('id, event:events(round_duration_minutes, start_time)')
      .eq('id', flightId)
      .maybeSingle(),
  ]);

  const matches = (matchRows as any[]) || [];
  const singles = matches.filter((m) => m.match_type === 'singles');
  const doubles = matches.find((m) => m.match_type === 'doubles');
  if (singles.length !== 6 || singles.some((m) => m.status !== 'completed')) {
    return { action: 'waiting' };
  }

  const entries = ((entryRows as any[]) || []).map((e) => ({ id: e.id, flight_seed: e.flight_seed }));
  const pairing = buildQuadDoublesRound(computeFlightStandings(entries, singles as QuadMatchView[]));
  if (!pairing) return { action: 'waiting' };

  const players = {
    player1_id: pairing.player1_id,
    player2_id: pairing.player2_id,
    player3_id: pairing.player3_id,
    player4_id: pairing.player4_id,
  };

  if (doubles) {
    const same = sameDoublesPairing(doubles, players);
    if (doubles.status === 'completed') return { action: 'locked', stalePairing: !same };
    if (same) return { action: 'unchanged' };
    await client.from('quad_matches').update(players).eq('id', doubles.id);
    return { action: 'repaired' };
  }

  // Place it where the auto-scheduler would have: the flight's first court
  // (the round's first match by id), one round after round 3.
  const byId = (a: any, b: any) => String(a.id).localeCompare(String(b.id));
  const r3 = singles.filter((m) => m.round === 3).sort(byId);
  const duration = (flight as any)?.event?.round_duration_minutes ?? 45;
  const r3Start = r3.map((m) => m.scheduled_at).filter(Boolean).sort()[0] as string | undefined;
  const scheduled_at = r3Start ? addMinutesToTime(String(r3Start).slice(0, 5), duration) : null;
  const court = r3.find((m) => m.court)?.court ?? null;

  const { error } = await client.from('quad_matches').insert({
    flight_id: flightId,
    round: 4,
    match_type: 'doubles',
    ...players,
    court,
    scheduled_at,
    scheduled_date: r3.find((m) => m.scheduled_date)?.scheduled_date ?? null,
  });
  // 23505 = the other request created it first. That one read the same six
  // completed singles, so its pairing is the same.
  if (error && error.code !== '23505') throw new Error(error.message);
  return { action: error ? 'unchanged' : 'created' };
}

/** Same two teams, regardless of which side or slot each player sits in. */
export function sameDoublesPairing(
  a: { player1_id: string | null; player2_id?: string | null; player3_id: string | null; player4_id?: string | null },
  b: { player1_id: string; player2_id: string; player3_id: string; player4_id: string }
): boolean {
  const team = (x: any, y: any) => [x, y].sort().join('+');
  const sides = (m: any) => [team(m.player1_id, m.player2_id), team(m.player3_id, m.player4_id)].sort().join('|');
  return sides(a) === sides(b);
}

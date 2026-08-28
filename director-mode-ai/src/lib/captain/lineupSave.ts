/**
 * Carrying player answers across a lineup save.
 *
 * Saving a lineup is a delete-and-reinsert of every `captain_lineups` row, so
 * anything stored on those rows is destroyed unless it is deliberately moved
 * across. On 2026-08-28 that silently wiped four players' confirmations when
 * one late addition was swapped onto court 1: the captain's roll-call went from
 * "6 of 8 in" to "nobody has answered", with no warning and no way back.
 *
 * The rule that fixes it: an answer belongs to the PERSON, not to the row it
 * happened to be stored on. Keyed by player id, it survives every swap, line
 * flip and renumbering — the same rule withdrawals already followed in the UI.
 */

export type SlotAnswer = {
  confirmedAt: string | null;
  confirmedSource: string | null;
  declinedAt: string | null;
  declineNote: string | null;
};

export type LineupRowShape = Record<string, unknown>;

export type SavedCourt = {
  courtNumber: number;
  courtType: 'singles' | 'doubles';
  player1Id: string | null;
  player2Id: string | null;
};

/** Every answer on the lineup as it stands, keyed by the player who gave it. */
export function answersByPlayer(rows: LineupRowShape[]): Map<string, SlotAnswer> {
  const out = new Map<string, SlotAnswer>();
  for (const row of rows || []) {
    for (const slot of [1, 2] as const) {
      const pid = row[`player${slot}_id`] as string | null;
      if (!pid) continue;
      const a: SlotAnswer = {
        confirmedAt: (row[`player${slot}_confirmed_at`] as string) ?? null,
        confirmedSource: (row[`player${slot}_confirmed_source`] as string) ?? null,
        declinedAt: (row[`player${slot}_declined_at`] as string) ?? null,
        declineNote: (row[`player${slot}_decline_note`] as string) ?? null,
      };
      // A row with neither is just an empty slot; storing it would make
      // "this player has an answer" untrue.
      if (a.confirmedAt || a.declinedAt) out.set(pid, a);
    }
  }
  return out;
}

/**
 * The rows to insert, with each player's existing answer re-attached.
 *
 * A player dropped from the lineup loses their answer, which is right — they
 * are not playing. A player who merely changed court keeps it: they still said
 * they would be there, and telling them the court moved is what the "send
 * updated lineup" button is for.
 */
export function rowsWithAnswers(
  courts: SavedCourt[],
  answers: Map<string, SlotAnswer>,
  base: { team_id: string; match_id: string },
): Record<string, unknown>[] {
  return courts.map((c) => {
    const a1 = c.player1Id ? answers.get(c.player1Id) : undefined;
    const a2 = c.player2Id ? answers.get(c.player2Id) : undefined;
    return {
      ...base,
      court_number: c.courtNumber,
      court_type: c.courtType,
      player1_id: c.player1Id,
      player2_id: c.player2Id,
      player1_confirmed_at: a1?.confirmedAt ?? null,
      player1_confirmed_source: a1?.confirmedSource ?? null,
      player1_declined_at: a1?.declinedAt ?? null,
      player1_decline_note: a1?.declineNote ?? null,
      player2_confirmed_at: a2?.confirmedAt ?? null,
      player2_confirmed_source: a2?.confirmedSource ?? null,
      player2_declined_at: a2?.declinedAt ?? null,
      player2_decline_note: a2?.declineNote ?? null,
    };
  });
}

/** How many answers survived the save, and how many were dropped with their player. */
export function answerTally(
  courts: SavedCourt[],
  answers: Map<string, SlotAnswer>,
): { kept: number; dropped: number } {
  const seated = new Set(
    courts.flatMap((c) => [c.player1Id, c.player2Id]).filter(Boolean) as string[],
  );
  let kept = 0;
  let dropped = 0;
  for (const id of answers.keys()) {
    if (seated.has(id)) kept += 1;
    else dropped += 1;
  }
  return { kept, dropped };
}

export interface ScriptPlayer {
  id: string;
  name: string;
  walkoutSongUrl: string | null;
  walkoutSongTitle: string | null;
  walkoutSongArtist: string | null;
  walkoutSongStartSeconds: number;
  walkoutAnnouncerAudioUrl: string | null;
}

export interface ScriptMatch {
  id: string;
  roundId: string;
  courtNumber: number;
  playerIds: string[];
  team1Score?: number | null;
  team2Score?: number | null;
  winnerTeam?: 1 | 2 | null;
}

export interface ScriptRound {
  id: string;
  roundNumber: number;
  status: string;
}

export interface ScoringInfo {
  scoringFormat?: string | null; // fixed_games, first_to_x, timed, pro_set, best_of_3_sets, best_of_3_tiebreak
  targetGames?: number | null;
  roundLengthMinutes?: number | null;
  matchFormat?: string | null; // doubles, mixed-doubles, etc.
}

export type Cue =
  | { kind: 'opening'; id: string; text: string; durationSec: number }
  | { kind: 'hype'; id: string; text: string; durationSec: number }
  | { kind: 'court_intro'; id: string; courtNumber: number; text: string; durationSec: number }
  | {
      kind: 'player';
      id: string;
      playerId: string;
      playerName: string;
      courtNumber: number;
      announcerText: string;
      announcerAudioUrl: string | null;
      walkoutSongUrl: string | null;
      walkoutSongTitle: string | null;
      walkoutSongStartSeconds: number;
      durationSec: number;
    }
  | { kind: 'closing'; id: string; text: string; durationSec: number };

export interface ScriptOptions {
  eventName: string;
  walkoutDurationSec: number;
  includeCourtIntros: boolean;
  includeScoringInfo: boolean;
  includeHype: boolean;
  openingText?: string;
  closingText?: string;
  scoring?: ScoringInfo;
  /** Matches from the round PRIOR to the one being scripted, used for hype highlights */
  priorMatches?: ScriptMatch[];
}

const DEFAULT_OPTIONS = {
  walkoutDurationSec: 18,
  includeCourtIntros: true,
  includeScoringInfo: false,
  includeHype: false,
  openingText: '',
  closingText: '',
} as const;

export function defaultOpeningText(roundNumber: number, eventName: string) {
  return `Welcome back to ${eventName}! It's time for Round ${roundNumber}. Players, this is your call.`;
}
export function defaultClosingText() {
  return `That's the lineup. Players ready… play ball!`;
}

// Internal aliases used by generateScript
const defaultOpening = defaultOpeningText;
const defaultClosing = defaultClosingText;

function scoringPhrase(scoring?: ScoringInfo): string {
  if (!scoring?.scoringFormat) return '';
  switch (scoring.scoringFormat) {
    case 'fixed_games':
      return scoring.targetGames ? `${scoring.targetGames} games` : '';
    case 'first_to_x':
      return scoring.targetGames ? `first to ${scoring.targetGames}` : '';
    case 'timed':
      return scoring.roundLengthMinutes ? `${scoring.roundLengthMinutes}-minute matches` : '';
    case 'pro_set':
      return '8-game pro set';
    case 'best_of_3_sets':
      return 'best of three sets';
    case 'best_of_3_tiebreak':
      return 'best of three with a final-set tiebreak';
    case 'flexible':
      return '';
    default:
      return '';
  }
}

function defaultCourtIntro(
  courtNumber: number,
  names: string[],
  includeScoring: boolean,
  scoring: ScoringInfo | undefined
) {
  const phrase = includeScoring ? scoringPhrase(scoring) : '';
  const scoringTag = phrase ? `, ${phrase}` : '';
  if (names.length === 4) {
    return `On Court ${courtNumber}${scoringTag}: ${names[0]} and ${names[1]}, taking on ${names[2]} and ${names[3]}.`;
  }
  if (names.length === 2) {
    return `On Court ${courtNumber}${scoringTag}: ${names[0]} versus ${names[1]}.`;
  }
  return `On Court ${courtNumber}${scoringTag}: ${names.join(', ')}.`;
}

function buildPlayerAnnouncerText(playerName: string, courtNumber: number) {
  return `Now arriving on Court ${courtNumber}… ${playerName}!`;
}

function teamNames(playerIds: string[], byId: Map<string, ScriptPlayer>): { team1: string[]; team2: string[] } {
  const names = playerIds.map((id) => byId.get(id)?.name).filter((n): n is string => !!n);
  if (names.length === 4) return { team1: [names[0], names[1]], team2: [names[2], names[3]] };
  if (names.length === 2) return { team1: [names[0]], team2: [names[1]] };
  return { team1: names, team2: [] };
}

function formatTeam(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return names.slice(0, -1).join(', ') + ` and ${names[names.length - 1]}`;
}

function generateHypeLines(priorMatches: ScriptMatch[], byId: Map<string, ScriptPlayer>): string[] {
  // Sort by court asc; only matches with a recorded winner; skip matches with no scores
  const completed = priorMatches
    .filter((m) => m.winnerTeam && m.team1Score != null && m.team2Score != null)
    .sort((a, b) => a.courtNumber - b.courtNumber);

  const lines: string[] = [];
  for (const m of completed) {
    const { team1, team2 } = teamNames(m.playerIds, byId);
    if (team1.length === 0 || team2.length === 0) continue;
    const winnerNames = m.winnerTeam === 1 ? team1 : team2;
    const loserNames = m.winnerTeam === 1 ? team2 : team1;
    const winScore = m.winnerTeam === 1 ? m.team1Score : m.team2Score;
    const loseScore = m.winnerTeam === 1 ? m.team2Score : m.team1Score;
    lines.push(
      `Last round on Court ${m.courtNumber}, ${formatTeam(winnerNames)} took down ${formatTeam(loserNames)}, ${winScore} to ${loseScore}.`
    );
  }
  return lines;
}

export function generateScript(
  round: ScriptRound,
  matches: ScriptMatch[],
  players: ScriptPlayer[],
  options: ScriptOptions
): Cue[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const playerById = new Map(players.map((p) => [p.id, p]));
  const cues: Cue[] = [];

  cues.push({
    kind: 'opening',
    id: `opening-${round.id}`,
    text: opts.openingText?.trim() || defaultOpening(round.roundNumber, opts.eventName),
    durationSec: 6,
  });

  if (opts.includeHype && opts.priorMatches && opts.priorMatches.length > 0) {
    const lines = generateHypeLines(opts.priorMatches, playerById);
    if (lines.length > 0) {
      // Cap at 3 highlights to keep pacing tight
      const capped = lines.slice(0, 3);
      capped.forEach((text, idx) => {
        cues.push({
          kind: 'hype',
          id: `hype-${round.id}-${idx}`,
          text,
          durationSec: 7,
        });
      });
    }
  }

  const matchesForRound = matches
    .filter((m) => m.roundId === round.id)
    .sort((a, b) => a.courtNumber - b.courtNumber);

  for (const match of matchesForRound) {
    const playerObjs = match.playerIds
      .map((id) => playerById.get(id))
      .filter((p): p is ScriptPlayer => !!p);
    if (playerObjs.length === 0) continue;

    if (opts.includeCourtIntros) {
      cues.push({
        kind: 'court_intro',
        id: `court-${match.id}`,
        courtNumber: match.courtNumber,
        text: defaultCourtIntro(
          match.courtNumber,
          playerObjs.map((p) => p.name),
          opts.includeScoringInfo,
          opts.scoring
        ),
        durationSec: 6,
      });
    }

    for (const p of playerObjs) {
      cues.push({
        kind: 'player',
        id: `player-${match.id}-${p.id}`,
        playerId: p.id,
        playerName: p.name,
        courtNumber: match.courtNumber,
        announcerText: buildPlayerAnnouncerText(p.name, match.courtNumber),
        announcerAudioUrl: p.walkoutAnnouncerAudioUrl,
        walkoutSongUrl: p.walkoutSongUrl,
        walkoutSongTitle: p.walkoutSongTitle,
        walkoutSongStartSeconds: p.walkoutSongStartSeconds,
        durationSec: p.walkoutSongUrl ? opts.walkoutDurationSec + 4 : 4,
      });
    }
  }

  cues.push({
    kind: 'closing',
    id: `closing-${round.id}`,
    text: opts.closingText?.trim() || defaultClosing(),
    durationSec: 5,
  });

  return cues;
}

export function totalDurationSec(cues: Cue[]): number {
  return cues.reduce((sum, c) => sum + c.durationSec + 1, 0);
}

/**
 * Returns the read-only spoken text for a cue. For player cues, this is the announcer line —
 * the walkout song is implied. Used by Rehearsal mode and as fallback display text.
 */
export function cueSpokenText(cue: Cue): string {
  switch (cue.kind) {
    case 'player':
      return cue.announcerText;
    default:
      return cue.text;
  }
}

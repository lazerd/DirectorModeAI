// Net Promoter Score math. Standard definition:
//   Promoters  = scores 9-10
//   Passives   = scores 7-8
//   Detractors = scores 0-6
//   NPS = (%promoters - %detractors), expressed -100..100, rounded to int.

export interface NpsBreakdown {
  score: number | null; // null when there are no responses
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
}

export function computeNps(scores: number[]): NpsBreakdown {
  const valid = scores.filter((s) => Number.isFinite(s) && s >= 0 && s <= 10);
  const responses = valid.length;
  if (responses === 0) {
    return { score: null, responses: 0, promoters: 0, passives: 0, detractors: 0 };
  }
  let promoters = 0;
  let passives = 0;
  let detractors = 0;
  for (const s of valid) {
    if (s >= 9) promoters++;
    else if (s >= 7) passives++;
    else detractors++;
  }
  const score = Math.round((promoters / responses) * 100 - (detractors / responses) * 100);
  return { score, responses, promoters, passives, detractors };
}

// Plain-language label for a score, board-appropriate.
export function npsLabel(score: number | null): string {
  if (score === null) return "No responses yet";
  if (score >= 70) return "World-class";
  if (score >= 50) return "Excellent";
  if (score >= 30) return "Good";
  if (score >= 0) return "Needs attention";
  return "Critical";
}

// Shared data shape for the Monthly Board Report.
// Both the live page (real data) and the demo page (sample data) produce this
// exact shape, so a single renderer draws both. Each section carries an
// `available` flag — when false, the renderer shows an honest "not collecting
// this yet" state instead of a fake number.

export interface TrendPoint {
  label: string; // e.g. "Jan", "Feb"
  value: number;
}

export interface MembershipSection {
  available: boolean;
  active: number;
  newThisPeriod: number;
  lapsedThisPeriod: number;
  netChange: number;
  trend: TrendPoint[]; // active members over trailing months
}

export interface CourtsSection {
  available: boolean;
  utilizationPct: number; // 0-100, overall for the period
  peakUtilizationPct: number;
  peakWindow: string; // "Saturday 9–11am"
  quietWindow: string; // "Tuesday 1–3pm"
  courtHoursBooked: number;
  courtHoursAvailable: number;
  byDay: TrendPoint[]; // utilization % per weekday, Mon→Sun
}

export interface ProgramLine {
  name: string;
  participants: number;
  deltaPct: number | null; // vs prior period; null if unknown
  note?: string;
}

export interface ParticipationSection {
  available: boolean;
  // De-duplicated unique humans across all programs. Null until the
  // master-players spine (Phase 2 ingestion) is feeding the report.
  totalUniqueParticipants: number | null;
  programs: ProgramLine[];
}

export interface NpsSection {
  available: boolean; // false → no responses collected yet
  score: number | null; // -100..100
  responses: number;
  promoters: number;
  passives: number;
  detractors: number;
  trend: TrendPoint[];
  themes: string[]; // short comment themes, optional
  surveyUrl?: string; // share link / QR target
}

export type AttentionSeverity = "opportunity" | "watch" | "good";

export interface AttentionItem {
  title: string;
  detail: string;
  severity: AttentionSeverity;
}

export interface BoardReportData {
  isDemo: boolean;
  clubName: string;
  logoUrl: string | null;
  periodLabel: string; // "May 2026"
  generatedAtLabel: string; // "June 1, 2026"
  membership: MembershipSection;
  courts: CourtsSection;
  participation: ParticipationSection;
  nps: NpsSection;
  attention: AttentionItem[];
}

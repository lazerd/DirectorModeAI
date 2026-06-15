import type { BoardReportData } from "./types";

// Realistic sample data for a mid-size swim & tennis club. Used by the demo
// page so prospects can see a fully-populated report before any real data
// flows in. Numbers are internally consistent (the exec narrative matches the
// section figures) and board-appropriate — headcounts and trends, not match
// results.
export const demoBoardReport: BoardReportData = {
  isDemo: true,
  clubName: "Sleepy Hollow Swim & Tennis Club",
  logoUrl: null,
  periodLabel: "May 2026",
  generatedAtLabel: "June 1, 2026",

  membership: {
    available: true,
    active: 486,
    newThisPeriod: 23,
    lapsedThisPeriod: 9,
    netChange: 14,
    trend: [
      { label: "Dec", value: 441 },
      { label: "Jan", value: 448 },
      { label: "Feb", value: 455 },
      { label: "Mar", value: 463 },
      { label: "Apr", value: 472 },
      { label: "May", value: 486 },
    ],
  },

  courts: {
    available: true,
    utilizationPct: 71,
    peakUtilizationPct: 96,
    peakWindow: "Saturday 9–11am",
    quietWindow: "Tuesday 1–3pm",
    courtHoursBooked: 2492,
    courtHoursAvailable: 3520,
    byDay: [
      { label: "Mon", value: 64 },
      { label: "Tue", value: 58 },
      { label: "Wed", value: 67 },
      { label: "Thu", value: 73 },
      { label: "Fri", value: 69 },
      { label: "Sat", value: 91 },
      { label: "Sun", value: 82 },
    ],
  },

  participation: {
    available: true,
    totalUniqueParticipants: 372,
    programs: [
      { name: "Junior Team Tennis", participants: 64, deltaPct: 25, note: "6 teams" },
      { name: "Adult Clinics & Lessons", participants: 118, deltaPct: 8 },
      { name: "Social Mixers", participants: 142, deltaPct: 12, note: "8 events" },
      { name: "Tournaments", participants: 51, deltaPct: -6, note: "2 events" },
      { name: "Junior Camps", participants: 39, deltaPct: 18 },
      { name: "Pro Shop / Stringing", participants: 47, deltaPct: 3 },
    ],
  },

  nps: {
    available: true,
    score: 58,
    responses: 134,
    promoters: 89,
    passives: 30,
    detractors: 15,
    trend: [
      { label: "Feb", value: 44 },
      { label: "Mar", value: 49 },
      { label: "Apr", value: 53 },
      { label: "May", value: 58 },
    ],
    themes: [
      "Court availability on weekends",
      "Quality of junior coaching",
      "Friendly front-desk staff",
      "Want more adult evening clinics",
    ],
  },

  attention: [
    {
      severity: "opportunity",
      title: "Weekend courts are at capacity",
      detail:
        "Saturday mornings ran at 91% (peak 96%). Demand is outstripping supply at prime times — worth discussing a reservation window change or added court time.",
    },
    {
      severity: "watch",
      title: "Tournament participation dipped",
      detail:
        "Tournament entries fell 6% vs. April. A spring social tournament could re-engage the competitive adult members.",
    },
    {
      severity: "good",
      title: "Junior program is the growth engine",
      detail:
        "Junior Team Tennis headcount is up 25% and camps up 18%. The youth pipeline is the strongest driver of new family memberships.",
    },
  ],
};

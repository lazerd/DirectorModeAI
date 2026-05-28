/**
 * CourtSheet — block styling derived from reservation type + source.
 *
 * Single owner of the color/label mapping so the legend, the block, and
 * the filter chips all read from the same source.
 */

import type { ReservationType, ReservationSource } from './types';

export interface BlockStyle {
  /** Hex string, e.g. '#FB923C'. */
  hex: string;
  /** Tailwind text class. */
  text: string;
  /** Bg utility (semi-transparent for the glass look). */
  bg: string;
  /** Border utility. */
  border: string;
  /** Glow color for the live-pulse effect (set as --cs-block-glow). */
  glow: string;
  label: string;
  abbrev: string;
}

const TYPE_STYLES: Record<ReservationType, BlockStyle> = {
  camp: {
    hex: '#A78BFA',
    text: 'text-violet-300',
    bg: 'bg-violet-400/10',
    border: 'border-violet-400/30',
    glow: 'rgba(167, 139, 250, 0.45)',
    label: 'Camp',
    abbrev: 'CAMP',
  },
  lesson: {
    hex: '#60A5FA',
    text: 'text-blue-300',
    bg: 'bg-blue-400/10',
    border: 'border-blue-400/30',
    glow: 'rgba(96, 165, 250, 0.45)',
    label: 'Lesson',
    abbrev: 'LSN',
  },
  event: {
    hex: '#FB923C',
    text: 'text-orange-300',
    bg: 'bg-orange-400/10',
    border: 'border-orange-400/30',
    glow: 'rgba(251, 146, 60, 0.45)',
    label: 'Event',
    abbrev: 'EVNT',
  },
  match: {
    hex: '#34D399',
    text: 'text-emerald-300',
    bg: 'bg-emerald-400/10',
    border: 'border-emerald-400/30',
    glow: 'rgba(52, 211, 153, 0.45)',
    label: 'Match',
    abbrev: 'MTCH',
  },
  member: {
    hex: '#22D3EE',
    text: 'text-cyan-300',
    bg: 'bg-cyan-400/10',
    border: 'border-cyan-400/30',
    glow: 'rgba(34, 211, 238, 0.45)',
    label: 'Member',
    abbrev: 'MEMB',
  },
  maintenance: {
    hex: '#FBBF24',
    text: 'text-amber-300',
    bg: 'bg-amber-400/10',
    border: 'border-amber-400/40',
    glow: 'rgba(251, 191, 36, 0.35)',
    label: 'Maintenance',
    abbrev: 'MNT',
  },
  blackout: {
    hex: '#71717A',
    text: 'text-zinc-400',
    bg: 'bg-zinc-500/15',
    border: 'border-zinc-500/40',
    glow: 'rgba(113, 113, 122, 0.3)',
    label: 'Closed',
    abbrev: 'BLK',
  },
  hold: {
    hex: '#D3FB52',
    text: 'text-[#D3FB52]',
    bg: 'bg-[#D3FB52]/10',
    border: 'border-[#D3FB52]/30',
    glow: 'rgba(211, 251, 82, 0.5)',
    label: 'Hold',
    abbrev: 'HLD',
  },
};

const SOURCE_LABELS: Record<ReservationSource, string> = {
  manual: 'Manual',
  ai: 'AI',
  lessons: 'LessonsMode',
  mixer: 'MixerMode',
  courtconnect: 'CourtConnect',
  tournaments: 'Tournaments',
  quads: 'Quads',
  jtt: 'JTT',
  import: 'Imported',
};

export function blockStyleFor(
  type: ReservationType,
  colorOverride: string | null
): BlockStyle {
  const base = TYPE_STYLES[type] ?? TYPE_STYLES.member;
  if (!colorOverride) return base;
  return { ...base, hex: colorOverride, glow: colorOverride };
}

export function sourceLabel(source: ReservationSource): string {
  return SOURCE_LABELS[source] ?? source;
}

export function allReservationTypes(): ReservationType[] {
  return Object.keys(TYPE_STYLES) as ReservationType[];
}

export function allReservationSources(): ReservationSource[] {
  return Object.keys(SOURCE_LABELS) as ReservationSource[];
}

export function typeLabel(t: ReservationType): string {
  return TYPE_STYLES[t]?.label ?? t;
}

import type { Metadata } from 'next';
import CalendarClient from './CalendarClient';

export const metadata: Metadata = {
  title: 'CalendarMode — plan the club year',
  description: 'Build the club event calendar for the year, with dates the engine can defend.',
};

// The year grid is entirely client-driven: it re-scores on every drag, so
// server-rendering the placement would be thrown away on first interaction.
export const dynamic = 'force-dynamic';

export default function CalendarPage() {
  return <CalendarClient />;
}

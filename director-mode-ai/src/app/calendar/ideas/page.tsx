import type { Metadata } from 'next';
import { CATALOG, CATALOG_GROUPS } from '@/lib/calendar/catalog';
import IdeasClient from './IdeasClient';

export const metadata: Metadata = {
  title: 'Event ideas — CalendarMode',
  description: 'A library of club event concepts, from the four Grand Slam mixers to a Calcutta.',
};

// The catalog is static data, so it renders on the server and ships as props —
// no fetch, no spinner. Browsing ideas is deliberately free: it's the part of
// CalendarMode worth showing someone who hasn't subscribed.
export default function IdeasPage() {
  return <IdeasClient catalog={CATALOG} groups={CATALOG_GROUPS} />;
}

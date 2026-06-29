import centroids from '@/app/benchmarks/_data/zipcentroids.json';

// US ZIP centroid table (lat/lng per 5-digit ZIP). ~900KB, so this only ever
// gets imported into server code — never ship it to the client bundle.
const ZIP_CENTROIDS = centroids as unknown as Record<string, [number, number]>;

export type LatLng = { lat: number; lng: number };

/** Normalize arbitrary input to a 5-digit ZIP string (or '' if not 5 digits). */
export function normalizeZip(input: string | null | undefined): string {
  const z = (input || '').replace(/\D/g, '').slice(0, 5);
  return z.length === 5 ? z : '';
}

/** Resolve a ZIP to its centroid lat/lng. Returns null if unknown. */
export function zipToLatLng(input: string | null | undefined): LatLng | null {
  const zip = normalizeZip(input);
  if (!zip) return null;
  const c = ZIP_CENTROIDS[zip];
  if (!c) return null;
  return { lat: c[0], lng: c[1] };
}

/** Great-circle distance in miles (haversine). */
export function milesBetween(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

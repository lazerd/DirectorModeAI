import Link from 'next/link';

// The 4 season-end divisions. Shown as a segmented toggle on each signup page
// so a parent who lands on the wrong age group can switch in one tap. Each
// division is its own event/slug, so switching just navigates — and whichever
// page they register + pay on is the division the entry (and payment) belongs to.
const DIVISIONS = [
  { label: '10U', slug: 'jtt-season-end-10u' },
  { label: '12U', slug: 'jtt-season-end-12u' },
  { label: '13 & Over', slug: 'jtt-season-end-13o' },
  { label: 'Open', slug: 'jtt-season-end-open' },
];

export function isSeasonEndSlug(slug: string): boolean {
  return DIVISIONS.some((d) => d.slug === slug);
}

export default function DivisionToggle({ currentSlug }: { currentSlug: string }) {
  return (
    <div>
      <div className="text-xs text-white/50 mb-1.5">Choose your age group</div>
      <div className="inline-flex flex-wrap gap-1 bg-white/5 rounded-xl p-1">
        {DIVISIONS.map((d) => {
          const active = d.slug === currentSlug;
          return active ? (
            <span
              key={d.slug}
              className="px-3 sm:px-4 py-2 rounded-lg text-sm font-semibold bg-[#D3FB52] text-[#001820]"
            >
              {d.label}
            </span>
          ) : (
            <Link
              key={d.slug}
              href={`/tournaments/${d.slug}`}
              className="px-3 sm:px-4 py-2 rounded-lg text-sm font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              {d.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

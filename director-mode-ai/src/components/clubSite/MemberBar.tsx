'use client';

/**
 * The club's own member sign-in, in the club's own colours.
 *
 * Load-bearing, not decoration. The club site is where the pricing rule lives
 * — members free, public pays — and a member who cannot sign in is charged the
 * public rate by a page that is simultaneously telling them members play free.
 *
 * It carries the CURRENT path through to `/login?next=`, so signing in returns
 * them to the court they were about to book rather than dumping them on a
 * ClubMode dashboard. `safeNext` on the other end rejects anything that is not
 * a same-site path, so this cannot become an open redirect.
 */

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

type Props = {
  clubSlug: string;
  signedIn: boolean;
  firstName: string | null;
  isMember: boolean;
  /** Whether members actually play free here — drives the wording. */
  membersFree: boolean;
  onPrimary: string;
};

export default function MemberBar({
  clubSlug,
  signedIn,
  firstName,
  isMember,
  membersFree,
  onPrimary,
}: Props) {
  const pathname = usePathname() || `/c/${clubSlug}`;
  const search = useSearchParams();
  const qs = search?.toString();
  const next = encodeURIComponent(qs ? `${pathname}?${qs}` : pathname);

  if (!signedIn) {
    return (
      <Link
        href={`/login?next=${next}`}
        className="rounded-lg border px-2.5 py-1 text-sm font-semibold hover:underline"
        style={{ borderColor: onPrimary, color: onPrimary, opacity: 0.9 }}
      >
        Member sign in
      </Link>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm" style={{ color: onPrimary }}>
      <span className="truncate opacity-90">{firstName ? `Hi, ${firstName}` : 'Signed in'}</span>
      {/*
        Says which rate they are on, because that is the only reason a member
        signs in here. Silence would leave them guessing whether it worked.
      */}
      <span
        className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
        style={{ background: `${onPrimary}26`, color: onPrimary }}
      >
        {isMember ? (membersFree ? 'Member · free courts' : 'Member') : 'Guest'}
      </span>
    </span>
  );
}

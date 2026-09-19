import TopDogAnnouncer from './TopDogAnnouncer';

/**
 * PA announcer for a tournament that lives on TopDog, not in ClubMode.
 * URL: /mixer/tournaments/topdog?t=1715[&host=club.topdoglive.com]
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; host?: string }>;
}) {
  const sp = await searchParams;
  return <TopDogAnnouncer tournamentId={sp.t ?? ''} host={sp.host ?? ''} />;
}

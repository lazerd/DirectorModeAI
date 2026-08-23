import AnnouncerClient from './AnnouncerClient';

export const metadata = {
  title: 'On Deck Announcer',
  description: 'Reads Serve Tennis court assignments over the PA.',
};

// Everything happens client-side against the Serve Tennis API; there is no
// server work to do and nothing here to prerender.
export const dynamic = 'force-dynamic';

export default function AnnouncePage() {
  return <AnnouncerClient />;
}

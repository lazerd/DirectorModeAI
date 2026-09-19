import TopDogDeskClient from './TopDogDeskClient';

export const metadata = {
  title: 'Tournament Desk',
  description: 'Assign courts, call players over the PA, and open courts as scores come in.',
};

// The order of play is read live from TopDog on every poll; there is nothing
// here worth prerendering.
export const dynamic = 'force-dynamic';

export default function DeskPage() {
  return <TopDogDeskClient />;
}

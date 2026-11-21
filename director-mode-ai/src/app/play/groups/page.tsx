import { GroupsManager } from '@/components/play/Groups';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your groups · Racquets IRL', robots: { index: false } };

export default function GroupsPage() {
  return <GroupsManager />;
}

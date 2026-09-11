import type { Metadata } from 'next';
import { getMaintenanceContextForPage } from '@/lib/maintenance/server';
import MaintenanceClient from '@/components/maintenance/MaintenanceClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'MaintenanceMode — ClubMode AI' };

/**
 * MaintenanceMode. The access check runs here on the server (staff and the
 * maintenance crew only; everyone else is redirected); the screen then loads
 * its data from /api/maintenance/board.
 */
export default async function MaintenancePage() {
  const ctx = await getMaintenanceContextForPage('/maintenance');
  return (
    <MaintenanceClient
      clubName={ctx.club.name}
      canManage={ctx.canManage}
      isCrew={ctx.isCrew}
      meId={ctx.user.id}
    />
  );
}

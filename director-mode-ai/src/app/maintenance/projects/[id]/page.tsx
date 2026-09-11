import type { Metadata } from 'next';
import { getMaintenanceContextForPage } from '@/lib/maintenance/server';
import ProjectClient from '@/components/maintenance/ProjectClient';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Project — MaintenanceMode' };

export default async function MaintenanceProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getMaintenanceContextForPage(`/maintenance/projects/${id}`);
  return <ProjectClient projectId={id} />;
}

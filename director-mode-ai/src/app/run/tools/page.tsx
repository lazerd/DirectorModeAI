import { redirect } from 'next/navigation';

// The directory moved to /tools (Task 3). This stub keeps the older /run/tools
// links — the ones already baked into section landing pages and the footer —
// resolving instead of 404ing. Cheap to keep, so keep it.
export default function RunToolsRedirect() {
  redirect('/tools');
}

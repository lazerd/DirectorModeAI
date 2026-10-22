import { redirect } from 'next/navigation';

/**
 * CaptainMode is free (2026-10-21), so there is nothing to subscribe to. The
 * route stays because old emails, bookmarks and 402 responses still link here;
 * it sends the captain straight to their teams.
 */
export default function SubscribePage() {
  redirect('/captain');
}

import { redirect } from 'next/navigation';

// Members management now lives inside PlayerVault — one place for every person at
// the club: rostered players, member accounts, and their roles. Keep this route
// working for old links/bookmarks by sending it there.
export default function MembersMoved() {
  redirect('/courtconnect/vault');
}

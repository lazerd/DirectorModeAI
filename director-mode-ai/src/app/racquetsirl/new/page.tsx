import { redirect } from 'next/navigation';

/** The redesign was previewed here (11/22/26). It is now the front door, so old links go to /racquetsirl. */
export default function RacquetsIRLNewPage() {
  redirect('/racquetsirl');
}

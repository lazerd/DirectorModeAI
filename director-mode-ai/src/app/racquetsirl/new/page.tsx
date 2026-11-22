import { permanentRedirect } from 'next/navigation';

/** The redesign was compared here, then became the main page (11/22/26). Old links still land. */
export default function RacquetsIRLNewPage() {
  permanentRedirect('/racquetsirl');
}

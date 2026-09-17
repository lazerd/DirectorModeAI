import { Users } from 'lucide-react';
import OpponentRows from './OpponentRows';
import OpponentImportPanel from './OpponentImportPanel';
import SeasonOpenerPanel from './SeasonOpenerPanel';

/**
 * League contacts — every opposing captain for the season, in one place.
 *
 * The information exists on the league site (TopDog puts captain and
 * co-captain, with phone and email, on each team page) but a captain who needs
 * it on match morning is three logins deep on a phone in a car park. Pulling it
 * into the team hub once a season is the whole feature.
 *
 * Contacts are keyed by opponent, not by match, because you play each club two
 * or three times and it is the same person every time.
 */

/** One person on the league's contact sheet. */
export type OpponentPerson = {
  name: string;
  usta_number: string | null;
  safe_play_expires: string | null;
  email: string | null;
  phone: string | null;
};

export type OpponentContact = {
  id: string;
  opponent: string;
  division: string | null;
  court_format: number | null;
  /** Every captain the league lists, not just the first two. */
  captains: OpponentPerson[];
  home_club: string | null;
  club_phone: string | null;
};

export default function OpponentDirectory({
  contacts,
  teamId,
  division,
}: {
  contacts: OpponentContact[];
  teamId: string;
  division: string | null;
}) {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2">
        <Users size={17} className="text-[#D3FB52]" />
        <h2 className="text-lg font-display text-white">League contacts</h2>
      </div>
      <p className="mt-1 text-[13px] text-white/40">
        Opposing captains for the season. Tap a name to call or email; tap +2 for everyone else the league lists.
      </p>

      <OpponentImportPanel teamId={teamId} division={division} />

      {/* Only once there is somebody to write to. */}
      {contacts.some((c) => c.captains.some((p) => p.email)) && (
        <SeasonOpenerPanel teamId={teamId} />
      )}

      {contacts.length === 0 && (
        <p className="mt-3 text-[13px] text-white/30">
          Nothing here yet — paste the league&rsquo;s contact list and every opposing captain lands
          in one place.
        </p>
      )}

      {contacts.length > 0 && <OpponentRows contacts={contacts} teamId={teamId} />}

    </section>
  );
}

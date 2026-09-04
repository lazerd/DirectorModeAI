import { Phone, Mail, Building2, Users, ShieldCheck } from 'lucide-react';
import RemoveOpponentButton from './RemoveOpponentButton';
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

function Person({ p, first }: { p: OpponentPerson; first: boolean }) {
  return (
    <div className="mt-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/30">
        {first ? 'Captain' : 'Also listed'}
      </p>
      <p className="text-[14px] text-white/85">{p.name}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {/* tel: and mailto: because this gets used one-handed, outdoors. */}
        {p.phone && (
          <a
            href={`tel:${p.phone.replace(/[^0-9+]/g, '')}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-[#D3FB52] hover:underline"
          >
            <Phone size={12} /> {p.phone}
          </a>
        )}
        {p.email && (
          <a
            href={`mailto:${p.email}`}
            className="inline-flex items-center gap-1.5 text-[13px] text-[#D3FB52] hover:underline"
          >
            <Mail size={12} /> {p.email}
          </a>
        )}
        {/* Safe Play is the clearance to be on court with children. Shown
            because it expires, and an expired one is the opposing club's
            problem to fix before the match, not a surprise on the day. */}
        {p.safe_play_expires && (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-white/30">
            <ShieldCheck size={12} /> Safe Play {p.safe_play_expires}
          </span>
        )}
      </div>
    </div>
  );
}

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
        Opposing captains for the season. Tap to call or email.
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

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {contacts.map((c) => (
          <div key={c.opponent} className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-[15px] font-semibold text-white">{c.opponent}</h3>
              <RemoveOpponentButton teamId={teamId} id={c.id} name={c.opponent} />
            </div>
            {(c.division || c.court_format) && (
              <p className="text-[12px] text-white/35">
                {c.division}
                {c.division && c.court_format ? ' · ' : ''}
                {c.court_format ? `hosts on ${c.court_format} courts` : ''}
              </p>
            )}
            {c.home_club && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] text-white/40">
                <Building2 size={12} /> {c.home_club}
                {c.club_phone && (
                  <>
                    {' · '}
                    <a href={`tel:${c.club_phone.replace(/[^0-9+]/g, '')}`} className="hover:text-white/70">
                      {c.club_phone}
                    </a>
                  </>
                )}
              </p>
            )}
            {c.captains.map((p, i) => (
              <Person key={p.name} p={p} first={i === 0} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

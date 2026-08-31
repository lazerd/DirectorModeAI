import { Phone, Mail, Building2, Users } from 'lucide-react';

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

export type OpponentContact = {
  opponent: string;
  captain_name: string | null;
  captain_email: string | null;
  captain_phone: string | null;
  cocaptain_name: string | null;
  cocaptain_email: string | null;
  cocaptain_phone: string | null;
  home_club: string | null;
  club_phone: string | null;
};

function Person({
  role, name, email, phone,
}: {
  role: string; name: string | null; email: string | null; phone: string | null;
}) {
  if (!name && !email && !phone) return null;
  return (
    <div className="mt-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-white/30">{role}</p>
      {name && <p className="text-[14px] text-white/85">{name}</p>}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {/* tel: and mailto: because this gets used one-handed, outdoors. */}
        {phone && (
          <a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} className="inline-flex items-center gap-1.5 text-[13px] text-[#D3FB52] hover:underline">
            <Phone size={12} /> {phone}
          </a>
        )}
        {email && (
          <a href={`mailto:${email}`} className="inline-flex items-center gap-1.5 text-[13px] text-[#D3FB52] hover:underline">
            <Mail size={12} /> {email}
          </a>
        )}
      </div>
    </div>
  );
}

export default function OpponentDirectory({ contacts }: { contacts: OpponentContact[] }) {
  if (!contacts.length) return null;

  return (
    <section className="mt-8">
      <div className="flex items-center gap-2">
        <Users size={17} className="text-[#D3FB52]" />
        <h2 className="text-lg font-display text-white">League contacts</h2>
      </div>
      <p className="mt-1 text-[13px] text-white/40">
        Opposing captains for the season. Tap to call or email.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {contacts.map((c) => (
          <div key={c.opponent} className="rounded-2xl border border-white/[0.08] bg-[#002838] p-5">
            <h3 className="text-[15px] font-semibold text-white">{c.opponent}</h3>
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
            <Person role="Captain" name={c.captain_name} email={c.captain_email} phone={c.captain_phone} />
            <Person role="Co-captain" name={c.cocaptain_name} email={c.cocaptain_email} phone={c.cocaptain_phone} />
          </div>
        ))}
      </div>
    </section>
  );
}

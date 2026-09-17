'use client';

import { useState } from 'react';
import { Phone, Mail, ShieldCheck, ChevronDown, Building2 } from 'lucide-react';
import RemoveOpponentButton from './RemoveOpponentButton';
import type { OpponentContact, OpponentPerson } from './OpponentDirectory';

/**
 * League contacts, one line per club.
 *
 * Each club used to print as a card with its division, home club, and a labelled
 * block per listed person with phone, email and Safe Play date. A JTT division
 * with ten clubs and up to five captains each ran for several screens, so
 * Darrin scrolled past it to reach everything below. Now: the club, its
 * captain, and tap-to-call / tap-to-email on one line. Everyone else the league
 * lists, the Safe Play dates and the venue open on tap — nothing is lost, it
 * just isn't all shouting at once.
 */

const digits = (s: string) => s.replace(/[^0-9+]/g, '');

function Contacts({ p }: { p: OpponentPerson }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {p.phone && (
        <a href={`tel:${digits(p.phone)}`} className="inline-flex items-center gap-1 text-[13px] text-[#D3FB52] hover:underline">
          <Phone size={12} /> {p.phone}
        </a>
      )}
      {p.email && (
        <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 text-[13px] text-[#D3FB52] hover:underline">
          <Mail size={12} /> <span className="truncate max-w-[13rem]">{p.email}</span>
        </a>
      )}
    </span>
  );
}

export default function OpponentRows({ contacts, teamId }: { contacts: OpponentContact[]; teamId: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  return (
    <ul className="mt-3 divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-[#002838]">
      {contacts.map((c) => {
        const lead = c.captains[0];
        const extra = c.captains.slice(1);
        const hasMore = extra.length > 0 || !!c.home_club || c.captains.some((p) => p.safe_play_expires);
        const isOpen = !!open[c.id];
        return (
          <li key={c.id} className="px-4 py-2.5">
            <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
              <span className="text-[14px] font-semibold text-white">{c.opponent}</span>
              {c.division && <span className="text-[11px] text-white/30">{c.division}</span>}
              {lead ? (
                <>
                  <span className="text-[13px] text-white/70">{lead.name}</span>
                  <Contacts p={lead} />
                </>
              ) : (
                <span className="text-[13px] text-white/30">no contact yet</span>
              )}
              <span className="ml-auto flex items-center gap-1">
                {hasMore && (
                  <button
                    onClick={() => setOpen((o) => ({ ...o, [c.id]: !o[c.id] }))}
                    aria-expanded={isOpen}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-white/40 hover:text-white"
                  >
                    {extra.length ? `+${extra.length}` : 'details'}
                    <ChevronDown size={13} className={isOpen ? 'rotate-180 transition' : 'transition'} />
                  </button>
                )}
                <RemoveOpponentButton teamId={teamId} id={c.id} name={c.opponent} />
              </span>
            </div>

            {isOpen && (
              <div className="mt-2 pl-1 space-y-1.5">
                {c.home_club && (
                  <p className="inline-flex items-center gap-1.5 text-[12.5px] text-white/40">
                    <Building2 size={12} /> {c.home_club}
                    {c.club_phone && (
                      <>
                        {' · '}
                        <a href={`tel:${digits(c.club_phone)}`} className="hover:text-white/70">
                          {c.club_phone}
                        </a>
                      </>
                    )}
                    {c.court_format ? ` · hosts on ${c.court_format} courts` : ''}
                  </p>
                )}
                {c.captains.map((p, i) => (
                  <div key={p.name} className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
                    <span className="text-[13px] text-white/70">
                      {p.name}
                      {i === 0 ? <span className="text-white/30"> · captain</span> : ''}
                    </span>
                    {i > 0 && <Contacts p={p} />}
                    {/* Safe Play is the clearance to be on court with children;
                        it expires, and an expired one is the other club's
                        problem to fix before the match, not a surprise on the day. */}
                    {p.safe_play_expires && (
                      <span className="inline-flex items-center gap-1 text-[12px] text-white/30">
                        <ShieldCheck size={12} /> Safe Play {p.safe_play_expires}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A club's homepage.
 *
 * Everything on it is data. The test of that is the second club: inserting one
 * club_site row for a different slug must produce a different-looking, correct
 * site with no code change. If a fact about one club appears anywhere in this
 * file, it is in the wrong place — it belongs in that club's row.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getClubSite } from '@/lib/clubSite/server';
import { readableOn, tint } from '@/lib/clubSite/theme';
import ProgramCard from '@/components/clubSite/ProgramCard';
import { formatPrice } from '@/lib/programs/sessions';

export const dynamic = 'force-dynamic';

export default async function ClubHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await getClubSite(slug);
  if (!bundle) notFound();

  const { club, site, theme, programs } = bundle;
  const onPrimary = readableOn(theme.primary);
  const where = [club.city, club.state].filter(Boolean).join(', ');
  const heroImage = site.hero_image_url || club.cover_image_url;
  const featured = programs.slice(0, 4);

  const Section = ({
    title,
    children,
    id,
  }: {
    title: string;
    children: React.ReactNode;
    id?: string;
  }) => (
    <section id={id} className="mx-auto max-w-5xl px-5 py-12">
      <h2
        className="text-2xl font-bold sm:text-3xl"
        style={{ fontFamily: theme.headingFamily }}
      >
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );

  return (
    <>
      {/* ---------------------------------------------------------- hero */}
      <div style={{ background: theme.primary, color: onPrimary }} className="relative">
        {heroImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={heroImage}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: 0.35 }}
            />
            <div className="absolute inset-0" style={{ background: tint(theme.ink, 0.35) }} />
          </>
        )}
        <div className="relative mx-auto max-w-5xl px-5 py-16 sm:py-24">
          <h1
            className="max-w-3xl text-4xl font-bold leading-[1.05] sm:text-6xl"
            style={{ fontFamily: theme.headingFamily }}
          >
            {site.hero_headline || club.name}
          </h1>
          {(site.hero_subhead || club.description) && (
            <p className="mt-5 max-w-2xl text-lg opacity-90 sm:text-xl">
              {site.hero_subhead || club.description}
            </p>
          )}
          {where && <p className="mt-3 text-sm opacity-70">{where}</p>}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href={site.hero_cta_href || `/c/${club.slug}/programs`}
              className="rounded-xl px-6 py-3 text-base font-bold"
              style={{ background: theme.secondary, color: readableOn(theme.secondary) }}
            >
              {site.hero_cta_label || 'See our programs'}
            </Link>
            {club.phone && (
              <a
                href={`tel:${club.phone.replace(/[^0-9+]/g, '')}`}
                className="rounded-xl border px-6 py-3 text-base font-semibold"
                style={{ borderColor: onPrimary, color: onPrimary }}
              >
                Call {club.phone}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------ amenities */}
      {site.amenities.length > 0 && (
        <div style={{ background: theme.surface, borderBottom: `1px solid ${tint(theme.ink, 0.1)}` }}>
          <div className="mx-auto grid max-w-5xl gap-x-8 gap-y-3 px-5 py-8 sm:grid-cols-2 lg:grid-cols-3">
            {site.amenities.map((a, i) => (
              <div key={i} className="flex gap-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                  style={{ background: theme.secondary }}
                />
                <div>
                  <div className="font-semibold">{a.label}</div>
                  {a.detail && (
                    <div className="text-sm" style={{ color: tint(theme.ink, 0.6) }}>
                      {a.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------------------------------------------------------- about */}
      {site.about_body && (
        <Section title={`About ${club.name}`}>
          {/* Plain paragraphs, split on blank lines — a club types prose, not markup. */}
          <div className="max-w-3xl space-y-4 text-base leading-relaxed">
            {site.about_body.split(/\n\s*\n/).map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </Section>
      )}

      {/* -------------------------------------------------------- programs */}
      {featured.length > 0 && (
        <Section title="Programs &amp; classes" id="programs">
          <div className="grid gap-4 sm:grid-cols-2">
            {featured.map((p) => (
              <ProgramCard
                key={p.id}
                program={p}
                clubSlug={club.slug}
                theme={theme}
                timeZone={club.timezone}
              />
            ))}
          </div>
          {programs.length > featured.length && (
            <Link
              href={`/c/${club.slug}/programs`}
              className="mt-6 inline-block text-sm font-bold"
              style={{ color: theme.primary }}
            >
              All {programs.length} programs →
            </Link>
          )}
        </Section>
      )}

      {/* ------------------------------------------------------ membership */}
      {site.membership_tiers.length > 0 && (
        <div style={{ background: theme.surface }}>
          <Section title="Membership">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {site.membership_tiers.map((t, i) => (
                <div
                  key={i}
                  className="rounded-2xl border p-5"
                  style={{ borderColor: tint(theme.ink, 0.12), background: theme.cream }}
                >
                  <div className="text-lg font-bold" style={{ fontFamily: theme.headingFamily }}>
                    {t.name}
                  </div>
                  {t.price_display && (
                    <div className="mt-1 text-2xl font-bold" style={{ color: theme.primary }}>
                      {t.price_display}
                      {t.period && (
                        <span className="text-sm font-medium opacity-60"> /{t.period}</span>
                      )}
                    </div>
                  )}
                  {t.includes.length > 0 && (
                    <ul className="mt-3 space-y-1.5 text-sm">
                      {t.includes.map((inc, j) => (
                        <li key={j} className="flex gap-2">
                          <span style={{ color: theme.secondary }}>✓</span>
                          <span style={{ color: tint(theme.ink, 0.75) }}>{inc}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {t.cta_href && (
                    <a
                      href={t.cta_href}
                      className="mt-4 inline-block rounded-lg px-4 py-2 text-sm font-bold"
                      style={{ background: theme.primary, color: onPrimary }}
                    >
                      {t.cta_label || 'Join'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ---------------------------------------------------------- courts */}
      {(site.court_rates.length > 0 || site.courts_blurb) && (
        <Section title="Court time">
          {site.courts_blurb && (
            <p className="max-w-3xl text-base leading-relaxed">{site.courts_blurb}</p>
          )}
          {site.court_rates.length > 0 && (
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr style={{ color: tint(theme.ink, 0.55) }} className="text-left">
                    <th className="py-2 pr-4 font-semibold">When</th>
                    <th className="py-2 pr-4 font-semibold">Members</th>
                    <th className="py-2 font-semibold">Public</th>
                  </tr>
                </thead>
                <tbody>
                  {site.court_rates.map((r, i) => (
                    <tr key={i} style={{ borderTop: `1px solid ${tint(theme.ink, 0.1)}` }}>
                      <td className="py-3 pr-4">
                        <div className="font-semibold">{r.label}</div>
                        {r.window && (
                          <div className="text-xs" style={{ color: tint(theme.ink, 0.55) }}>
                            {r.window}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-4">{formatPrice(r.member_cents)}</td>
                      <td className="py-3">{formatPrice(r.public_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Link
            href={`/c/${club.slug}/courts`}
            className="mt-5 inline-block text-sm font-bold"
            style={{ color: theme.primary }}
          >
            Court hours &amp; booking →
          </Link>
        </Section>
      )}

      {/* -------------------------------------------------------- services */}
      {site.services.length > 0 && (
        <div style={{ background: theme.surface }}>
          <Section title="At the club">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {site.services.map((s, i) => (
                <div
                  key={i}
                  className="rounded-2xl border p-5"
                  style={{ borderColor: tint(theme.ink, 0.12), background: theme.cream }}
                >
                  <div className="font-bold">{s.name}</div>
                  {s.blurb && (
                    <p className="mt-1.5 text-sm" style={{ color: tint(theme.ink, 0.7) }}>
                      {s.blurb}
                    </p>
                  )}
                  {s.price_note && (
                    <div className="mt-2 text-sm font-semibold" style={{ color: theme.primary }}>
                      {s.price_note}
                    </div>
                  )}
                  {s.cta_href && (
                    <a
                      href={s.cta_href}
                      className="mt-3 inline-block text-sm font-bold"
                      style={{ color: theme.primary }}
                    >
                      {s.cta_label || 'Learn more'} →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ----------------------------------------------------------- staff */}
      {site.staff.length > 0 && (
        <Section title="Our team">
          <div className="grid gap-6 sm:grid-cols-2">
            {site.staff.map((s, i) => (
              <div key={i} className="flex gap-4">
                {s.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.photo_url}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-2xl object-cover"
                  />
                ) : (
                  <div
                    className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl text-2xl font-bold"
                    style={{ background: tint(theme.primary, 0.12), color: theme.primary }}
                  >
                    {s.name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="font-bold">{s.name}</div>
                  {s.title && (
                    <div className="text-sm font-medium" style={{ color: theme.secondary }}>
                      {s.title}
                    </div>
                  )}
                  {s.bio && (
                    <p className="mt-1.5 text-sm leading-relaxed" style={{ color: tint(theme.ink, 0.7) }}>
                      {s.bio}
                    </p>
                  )}
                  {(s.email || s.phone) && (
                    <div className="mt-1.5 text-xs" style={{ color: tint(theme.ink, 0.55) }}>
                      {s.email && (
                        <a href={`mailto:${s.email}`} className="hover:underline">
                          {s.email}
                        </a>
                      )}
                      {s.email && s.phone ? ' · ' : ''}
                      {s.phone}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* -------------------------------------------------- partner links */}
      {site.partner_links.length > 0 && (
        <div style={{ background: theme.surface }}>
          <Section title="Also at the club">
            {/*
              Other pros' own programs. Linked out, not sold here — their
              registration lives on their own pages, and pretending otherwise
              would put the club in the middle of someone else's business.
            */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {site.partner_links.map((p, i) => (
                <a
                  key={i}
                  href={p.href || '#'}
                  className="block rounded-2xl border p-5 transition-shadow hover:shadow-md"
                  style={{ borderColor: tint(theme.ink, 0.12), background: theme.cream }}
                >
                  {p.sport && (
                    <div
                      className="text-[11px] font-bold uppercase tracking-wider"
                      style={{ color: theme.secondary }}
                    >
                      {p.sport}
                    </div>
                  )}
                  <div className="mt-1 font-bold">{p.name}</div>
                  {p.blurb && (
                    <p className="mt-1.5 text-sm" style={{ color: tint(theme.ink, 0.7) }}>
                      {p.blurb}
                    </p>
                  )}
                  {p.href && (
                    <div className="mt-3 text-sm font-bold" style={{ color: theme.primary }}>
                      Visit →
                    </div>
                  )}
                </a>
              ))}
            </div>
          </Section>
        </div>
      )}

      {/* ------------------------------------------------------ documents */}
      {site.documents.length > 0 && (
        <Section title="Forms &amp; documents">
          <div className="flex flex-wrap gap-3">
            {site.documents.map((d, i) => (
              <a
                key={i}
                href={d.href || '#'}
                className="rounded-xl border px-4 py-3 text-sm font-semibold"
                style={{ borderColor: tint(theme.ink, 0.15), background: theme.surface }}
              >
                {d.label} ↓
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* -------------------------------------------------------- contact */}
      <div style={{ background: tint(theme.primary, 0.08) }}>
        <Section title="Visit us">
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-1 text-base">
              {club.address && <div>{club.address}</div>}
              {where && (
                <div>
                  {where} {club.zip || ''}
                </div>
              )}
              {club.phone && (
                <div className="pt-2">
                  <a
                    href={`tel:${club.phone.replace(/[^0-9+]/g, '')}`}
                    className="font-semibold hover:underline"
                    style={{ color: theme.primary }}
                  >
                    {club.phone}
                  </a>
                </div>
              )}
              {club.email && (
                <div>
                  <a
                    href={`mailto:${club.email}`}
                    className="font-semibold hover:underline"
                    style={{ color: theme.primary }}
                  >
                    {club.email}
                  </a>
                </div>
              )}
            </div>
            {site.booking_policy_body && (
              <div
                className="rounded-2xl border p-5 text-sm leading-relaxed"
                style={{ borderColor: tint(theme.ink, 0.12), background: theme.surface }}
              >
                <div className="mb-2 font-bold">Booking a court</div>
                {site.booking_policy_body.split(/\n\s*\n/).map((p, i) => (
                  <p key={i} className={i ? 'mt-2' : ''} style={{ color: tint(theme.ink, 0.75) }}>
                    {p}
                  </p>
                ))}
              </div>
            )}
          </div>
        </Section>
      </div>
    </>
  );
}

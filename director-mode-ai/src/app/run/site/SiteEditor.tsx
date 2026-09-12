'use client';

/**
 * The club's website, editable.
 *
 * Everything here changes about once a year — amenities, staff bios,
 * membership tiers. The weekly work (skip dates, prices) deliberately lives on
 * its own screen, because mixing the two turns a thirty-second edit into a
 * scroll hunt.
 *
 * Every field autosaves on blur. There is no Save button: a director who has
 * to find one will eventually lose work, and the thing being sold here is that
 * changing your own website is not a chore.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

type ListKey =
  | 'amenities'
  | 'membership_tiers'
  | 'staff'
  | 'partner_links'
  | 'documents'
  | 'services';

type Site = Record<string, unknown> & { status?: 'draft' | 'published' };
type Club = { id: string; slug: string; name: string; timezone: string };

/** Field definitions per list, so add/remove/edit is one generic component. */
const LISTS: Record<
  ListKey,
  {
    title: string;
    blurb: string;
    fields: { key: string; label: string; placeholder?: string; area?: boolean; money?: boolean }[];
    addLabel: string;
  }
> = {
  amenities: {
    title: 'What you have',
    blurb: 'Courts, pool, gym, locker rooms — the things a visitor scans for first.',
    fields: [
      { key: 'label', label: 'Amenity', placeholder: '9 lighted hard courts' },
      { key: 'detail', label: 'Detail', placeholder: 'Open until 10pm' },
    ],
    addLabel: 'Add an amenity',
  },
  membership_tiers: {
    title: 'Membership',
    blurb:
      'Price is free text on purpose — "from $130", "$115 + initiation" and "Call for rates" all have to fit.',
    fields: [
      { key: 'name', label: 'Tier', placeholder: 'Family' },
      { key: 'price_display', label: 'Price', placeholder: 'from $130' },
      { key: 'period', label: 'Per', placeholder: 'month' },
      { key: 'cta_label', label: 'Button', placeholder: 'Join' },
      { key: 'cta_href', label: 'Button link', placeholder: 'https://…' },
    ],
    addLabel: 'Add a tier',
  },
  staff: {
    title: 'Your team',
    blurb: 'The pros who work for you. A photo helps more than anything else on the page.',
    fields: [
      { key: 'name', label: 'Name' },
      { key: 'title', label: 'Title', placeholder: 'Director of Tennis' },
      { key: 'bio', label: 'Bio', area: true },
      { key: 'photo_url', label: 'Photo URL' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
    ],
    addLabel: 'Add someone',
  },
  services: {
    title: 'At the club',
    blurb: 'Stringing, ball machine, anything else you offer that is not a class.',
    fields: [
      { key: 'name', label: 'Service', placeholder: 'Racquet stringing' },
      { key: 'blurb', label: 'Description', area: true },
      { key: 'price_note', label: 'Price', placeholder: 'From $25' },
      { key: 'cta_label', label: 'Button' },
      { key: 'cta_href', label: 'Button link' },
    ],
    addLabel: 'Add a service',
  },
  partner_links: {
    title: 'Other pros at your club',
    blurb:
      'People who run their own programs on your courts. These link out to their pages — their registration stays theirs.',
    fields: [
      { key: 'name', label: 'Name', placeholder: 'Carmen — Pickleball' },
      { key: 'sport', label: 'Sport', placeholder: 'Pickleball' },
      { key: 'blurb', label: 'Description', area: true },
      { key: 'href', label: 'Their link' },
    ],
    addLabel: 'Add a pro',
  },
  documents: {
    title: 'Forms & documents',
    blurb: 'The member packet, waivers, anything you hand people as a PDF.',
    fields: [
      { key: 'label', label: 'Name', placeholder: 'Member packet' },
      { key: 'href', label: 'Link' },
    ],
    addLabel: 'Add a document',
  },
};

export default function SiteEditor() {
  const [site, setSite] = useState<Site | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/club-site');
    const j = (await res.json().catch(() => ({}))) as {
      site?: Site;
      club?: Club;
      error?: string;
    };
    if (!res.ok) setError(j.error || 'Could not load your site.');
    else {
      setSite(j.site ?? {});
      setClub(j.club ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async (patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/club-site', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; site?: Site };
      if (!res.ok) {
        setError(j.error || 'Could not save.');
        return false;
      }
      if (j.site) setSite(j.site);
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  async function upload(kind: string, file: File, onUrl: (url: string) => void) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/club-site/upload?kind=${kind}`, { method: 'POST', body: fd });
      const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !j.url) {
        setError(j.error || 'Upload failed.');
        return;
      }
      onUrl(j.url);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-white/40">Loading your site…</p>;
  if (!site) return <p className="text-red-300">{error || 'Could not load your site.'}</p>;

  const field =
    'w-full rounded-lg border border-white/10 bg-[#001820] px-3 py-2 text-sm focus:border-[#D3FB52]/50 focus:outline-none';
  const labelCls = 'mb-1 block text-[11px] font-semibold uppercase tracking-wider text-white/40';

  const Scalar = ({
    name,
    label,
    placeholder,
    rows,
  }: {
    name: string;
    label: string;
    placeholder?: string;
    rows?: number;
  }) => (
    <div>
      <label className={labelCls} htmlFor={name}>
        {label}
      </label>
      {rows ? (
        <textarea
          id={name}
          rows={rows}
          defaultValue={(site[name] as string) ?? ''}
          placeholder={placeholder}
          onBlur={(e) => {
            if (e.target.value === ((site[name] as string) ?? '')) return;
            save({ [name]: e.target.value });
          }}
          style={{ color: '#ffffff' }}
          className={field}
        />
      ) : (
        <input
          id={name}
          defaultValue={(site[name] as string) ?? ''}
          placeholder={placeholder}
          onBlur={(e) => {
            if (e.target.value === ((site[name] as string) ?? '')) return;
            save({ [name]: e.target.value });
          }}
          style={{ color: '#ffffff' }}
          className={field}
        />
      )}
    </div>
  );

  /** Generic list editor — rows in, rows out, one PATCH per change. */
  const ListEditor = ({ listKey }: { listKey: ListKey }) => {
    const spec = LISTS[listKey];
    const rows = (Array.isArray(site[listKey]) ? site[listKey] : []) as Record<string, unknown>[];

    const write = (next: Record<string, unknown>[]) => save({ [listKey]: next });

    return (
      <section>
        <h2 className="font-display text-xl text-white">{spec.title}</h2>
        <p className="mt-1 text-sm text-white/45">{spec.blurb}</p>
        <div className="mt-4 space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="rounded-xl border border-white/[0.08] bg-[#002838] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {spec.fields.map((f) => (
                  <div key={f.key} className={f.area ? 'sm:col-span-2' : ''}>
                    <label className={labelCls}>{f.label}</label>
                    {f.area ? (
                      <textarea
                        rows={3}
                        defaultValue={(row[f.key] as string) ?? ''}
                        placeholder={f.placeholder}
                        onBlur={(e) => {
                          if (e.target.value === ((row[f.key] as string) ?? '')) return;
                          const next = [...rows];
                          next[i] = { ...row, [f.key]: e.target.value };
                          write(next);
                        }}
                        style={{ color: '#ffffff' }}
                        className={field}
                      />
                    ) : (
                      <input
                        defaultValue={
                          f.money
                            ? row[f.key] == null
                              ? ''
                              : String((row[f.key] as number) / 100)
                            : ((row[f.key] as string) ?? '')
                        }
                        placeholder={f.placeholder}
                        inputMode={f.money ? 'decimal' : undefined}
                        onBlur={(e) => {
                          const raw = e.target.value.trim();
                          const value = f.money
                            ? raw === ''
                              ? null
                              : Math.round(parseFloat(raw) * 100)
                            : raw;
                          if (f.money && value !== null && !Number.isFinite(value)) return;
                          if (value === (row[f.key] ?? (f.money ? null : ''))) return;
                          const next = [...rows];
                          next[i] = { ...row, [f.key]: value };
                          write(next);
                        }}
                        style={{ color: '#ffffff' }}
                        className={field}
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-4 text-xs">
                {listKey === 'staff' && (
                  <label className="cursor-pointer font-medium text-white/50 hover:text-white">
                    Upload a photo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        upload('staff', f, (url) => {
                          const next = [...rows];
                          next[i] = { ...row, photo_url: url };
                          write(next);
                        });
                      }}
                    />
                  </label>
                )}
                {listKey === 'documents' && (
                  <label className="cursor-pointer font-medium text-white/50 hover:text-white">
                    Upload a PDF
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        upload('doc', f, (url) => {
                          const next = [...rows];
                          next[i] = { ...row, href: url };
                          write(next);
                        });
                      }}
                    />
                  </label>
                )}
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...rows];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      write(next);
                    }}
                    className="font-medium text-white/40 hover:text-white"
                  >
                    Move up
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => write(rows.filter((_, j) => j !== i))}
                  className="text-white/35 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => write([...rows, {}])}
            disabled={busy}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white disabled:opacity-50"
          >
            {spec.addLabel}
          </button>
        </div>
      </section>
    );
  };

  const published = site.status === 'published';

  return (
    <div className="space-y-10">
      {/* ------------------------------------------------- publish + status */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.08] bg-[#002838] p-4">
        <div>
          <div className="font-semibold text-white">
            {published ? 'Your site is live' : 'Your site is a draft'}
          </div>
          {club && (
            <div className="mt-0.5 text-sm text-white/50">
              {published ? (
                <a
                  href={`/c/${club.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  clubmode.ai/c/{club.slug} ↗
                </a>
              ) : (
                <>Only you can see it. Publish when you&apos;re ready.</>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-xs text-[#D3FB52]">Saved</span>}
          {club && (
            <a
              href={`/c/${club.slug}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
            >
              Preview
            </a>
          )}
          <button
            type="button"
            onClick={() => save({ status: published ? 'draft' : 'published' })}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 ${
              published
                ? 'border border-white/15 text-white/70 hover:text-white'
                : 'bg-[#D3FB52] text-[#001820]'
            }`}
          >
            {published ? 'Unpublish' : 'Publish my site'}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-300">{error}</p>}

      {/* --------------------------------------------------------- the top */}
      <section>
        <h2 className="font-display text-xl text-white">The top of your page</h2>
        <div className="mt-4 grid gap-4">
          <Scalar
            name="hero_headline"
            label="Headline"
            placeholder="Your club name, or something better"
          />
          <Scalar
            name="hero_subhead"
            label="One line under it"
            placeholder="Nine lighted courts, juniors to 4.5, in the heart of town"
            rows={2}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Scalar name="hero_cta_label" label="Button" placeholder="See our programs" />
            <Scalar name="hero_cta_href" label="Button link" placeholder="Leave blank for programs" />
          </div>
          <div>
            <label className={labelCls}>Background photo</label>
            <div className="flex flex-wrap items-center gap-3">
              {site.hero_image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={site.hero_image_url as string}
                  alt=""
                  className="h-16 w-28 rounded-lg object-cover"
                />
              ) : (
                <div className="grid h-16 w-28 place-items-center rounded-lg border border-white/10 text-xs text-white/30">
                  none
                </div>
              )}
              <label className="cursor-pointer rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white">
                {site.hero_image_url ? 'Replace' : 'Upload'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    upload('hero', f, (url) => save({ hero_image_url: url }));
                  }}
                />
              </label>
              <label className="cursor-pointer rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white">
                Upload your logo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    // Written to cc_clubs by the route, so a reload is how the
                    // header picks it up.
                    upload('logo', f, () => load());
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- colors */}
      <section>
        <h2 className="font-display text-xl text-white">Your colors</h2>
        <p className="mt-1 text-sm text-white/45">
          Your site, your emails and your link previews all use these.
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          {[
            ['color_primary', 'Main'],
            ['color_secondary', 'Accent'],
            ['color_ink', 'Text'],
            ['color_cream', 'Background'],
            ['color_surface', 'Cards'],
          ].map(([key, label]) => (
            <div key={key}>
              <label className={labelCls}>{label}</label>
              <input
                type="color"
                defaultValue={(site[key] as string) || '#14532d'}
                onBlur={(e) => save({ [key]: e.target.value })}
                className="h-10 w-16 cursor-pointer rounded-lg border border-white/10 bg-[#001820]"
              />
            </div>
          ))}
          <div>
            <label className={labelCls}>Font</label>
            <select
              defaultValue={(site.font_choice as string) || 'sans'}
              onChange={(e) => save({ font_choice: e.target.value })}
              style={{ color: '#ffffff' }}
              className={field}
            >
              <option value="sans">Clean sans</option>
              <option value="serif">Classic serif</option>
              <option value="condensed">Bold condensed</option>
            </select>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- about */}
      <section>
        <h2 className="font-display text-xl text-white">About the club</h2>
        <div className="mt-4 grid gap-4">
          <Scalar name="about_body" label="About" rows={6} placeholder="Blank lines make paragraphs." />
          <Scalar name="courts_blurb" label="About your courts" rows={3} />
          <Scalar
            name="booking_policy_body"
            label="How booking works"
            rows={4}
            placeholder="Members book free up to 7 days ahead. Public $24/hour, 3 days ahead."
          />
        </div>
      </section>

      <ListEditor listKey="amenities" />
      <ListEditor listKey="membership_tiers" />

      {/*
        Court rates moved out of here to /run/site/courts when online booking
        landed, because those rows are what a booking is actually PRICED
        against. Editing a second copy on this screen would have let a director
        change a number and watch nothing happen — so this points at the real
        one rather than offering a list that no longer drives anything.
      */}
      <section>
        <h2 className="font-display text-xl text-white">Court rates</h2>
        <p className="mt-1 text-sm text-white/45">
          Your rates live with court booking now, because they are the prices a booking is charged
          at — not just a table on the page.
        </p>
        <Link
          href="/run/site/courts"
          className="mt-3 inline-block rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-white/70 hover:text-white"
        >
          Court rates &amp; booking →
        </Link>
      </section>

      <ListEditor listKey="services" />
      <ListEditor listKey="staff" />
      <ListEditor listKey="partner_links" />
      <ListEditor listKey="documents" />

      {/* ------------------------------------------------------------- SEO */}
      <section>
        <h2 className="font-display text-xl text-white">How you look in Google</h2>
        <div className="mt-4 grid gap-4">
          <Scalar name="seo_title" label="Page title" placeholder="Your club — City, ST" />
          <Scalar name="seo_description" label="Description" rows={2} />
        </div>
      </section>

      <div className="border-t border-white/[0.06] pt-6">
        <Link
          href="/run/site/classes"
          className="rounded-lg bg-[#D3FB52] px-5 py-2.5 text-sm font-semibold text-[#001820]"
        >
          Edit your classes →
        </Link>
      </div>
    </div>
  );
}

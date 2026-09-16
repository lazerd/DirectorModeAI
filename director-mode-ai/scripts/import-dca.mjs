/**
 * import-dca.mjs — load the Directors Club of America roster into the CRM.
 *
 *   cd C:\Users\darri\directors-club-db && python export_for_crm.py
 *   node scripts/import-dca.mjs [--dry]
 *
 * The DCA is an invite network of racquets directors and GMs at private clubs:
 * 521 clubs and 705 named contacts, scraped 2026-06-29 into
 * C:\Users\darri\directors-club-db. Every one of them buys the thing we sell.
 *
 * IDEMPOTENT. Orgs are matched on `slug` (dca-<club name>), contacts on
 * (org, lower(email)). A re-run after a fresh export adds what is new and
 * leaves everything a rep has since edited alone — stage, next step, notes and
 * owner are never overwritten, because those are the rep's work, not the
 * scrape's.
 *
 * NOT IMPORTED: vendors, universities and associations from the same
 * directory. They are in the DCA because they sell to clubs or teach at them;
 * they are not buyers of club software.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const EXPORT = 'C:\\Users\\darri\\directors-club-db\\exports\\crm_import.json';
const DRY = process.argv.includes('--dry');
const OWNER = 'darrinjco@gmail.com';

/*
 * Darrin's own club, and the clubs we are already working, do not belong in a
 * cold list. Matched on the export's canonical key.
 */
const SKIP_KEYS = new Set(['sleepy hollow country club']);
const SKIP_IF_EXISTS = ['rossmoor-tennis-club', 'rossmoor-pickleball-club', 'lafayette-tennis-club'];

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const REGION_LABEL = {
  EAST: 'East',
  CENTRAL: 'Central',
  WEST: 'West',
  INTERNATIONAL: 'International',
};

async function main() {
  const rows = JSON.parse(readFileSync(EXPORT, 'utf8'));
  console.log(`Export: ${rows.length} clubs, ${rows.reduce((n, o) => n + o.contacts.length, 0)} contacts`);

  // Everything already in the CRM, so a second run is a no-op and the three
  // live deals are never duplicated under a DCA slug.
  const { data: existing } = await db.from('crm_orgs').select('id, slug, name');
  const bySlug = new Map((existing ?? []).map((o) => [o.slug, o]));
  const byName = new Map((existing ?? []).map((o) => [o.name.toLowerCase(), o]));

  let newOrgs = 0;
  let newContacts = 0;
  let skipped = 0;
  const noEmail = [];

  for (const club of rows) {
    if (SKIP_KEYS.has(club.key)) {
      skipped += 1;
      continue;
    }
    const already = bySlug.get(club.slug) || byName.get(club.name.toLowerCase());
    if (already && SKIP_IF_EXISTS.includes(already.slug)) {
      skipped += 1;
      continue;
    }

    let orgId = already?.id ?? null;
    if (!orgId) {
      const region = REGION_LABEL[club.region] || null;
      const row = {
        name: club.name,
        slug: club.slug,
        website: club.website || null,
        state: club.state || null,
        type: 'club',
        stage: 'researching',
        owner_email: OWNER,
        source: 'Directors Club of America',
        notes: [
          region ? `DCA ${region} region.` : 'DCA member club (region not recorded).',
          'From the members-only directory, scraped 2026-06-29. No contact has been approached yet.',
        ].join(' '),
      };
      if (DRY) {
        newOrgs += 1;
      } else {
        // Two clubs can slug the same ("Legacy Youth Tennis Center" twice in
        // the roster under different spellings); give the second its own.
        for (let n = 1; !orgId; n += 1) {
          const { data, error } = await db
            .from('crm_orgs')
            .insert(n === 1 ? row : { ...row, slug: `${row.slug}-${n}` })
            .select('id')
            .single();
          if (!error) {
            orgId = data.id;
            newOrgs += 1;
          } else if (error.code !== '23505' || n > 5) {
            throw new Error(`${club.name}: ${error.message}`);
          }
        }
      }
    }
    if (DRY || !orgId) continue;

    const { data: haveRows } = await db.from('crm_contacts').select('email, full_name').eq('org_id', orgId);
    const have = new Set((haveRows ?? []).map((c) => (c.email || '').toLowerCase()).filter(Boolean));
    // One row per person per club, so a name already on the board is a match
    // even when the directory lists them twice under two addresses.
    const haveNames = new Set((haveRows ?? []).map((c) => (c.full_name || '').toLowerCase()));

    const fresh = club.contacts.filter((c) => {
      if (!c.email || have.has(c.email) || haveNames.has(c.full_name.toLowerCase())) return false;
      have.add(c.email);
      haveNames.add(c.full_name.toLowerCase());
      return true;
    });
    if (!fresh.length) {
      if (!club.contacts.length) noEmail.push(club.name);
      continue;
    }
    const { error } = await db.from('crm_contacts').insert(
      fresh.map((c, i) => ({
        org_id: orgId,
        full_name: c.full_name,
        // The directory lists no titles. Leaving it null is honest; a guessed
        // "Director of Racquets" in a merge field would go out in an email.
        title: null,
        email: c.email,
        role: 'DCA directory',
        is_primary: i === 0 && have.size === 0,
        notes: c.personal ? 'Personal email address from the DCA directory.' : null,
      })),
    );
    if (error) throw new Error(`${club.name} contacts: ${error.message}`);
    newContacts += fresh.length;
  }

  console.log(
    `${DRY ? 'Would add' : 'Added'} ${newOrgs} clubs and ${newContacts} contacts; skipped ${skipped} (ours, or already a live deal).`,
  );
  if (noEmail.length) {
    console.log(`${noEmail.length} clubs have no contact yet — research targets, not send targets.`);
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});

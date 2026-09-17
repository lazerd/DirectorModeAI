import { describe, it, expect } from 'vitest';
import { compose, firstNameOf, renderTemplate, mergeValuesFor, signatureFor } from './compose';
import type { Contact, Org } from './types';

/**
 * These are cold emails to real volunteer board members. Every test here is a
 * way one of them could go out wrong.
 */

const ORG: Org = {
  id: 'o1',
  name: 'Rossmoor Tennis Club',
  slug: 'rossmoor-tennis-club',
  club_id: null,
  website: 'https://rtc.wildapricot.org/',
  city: 'Walnut Creek',
  state: 'CA',
  type: 'club',
  member_count: 200,
  stage: 'researching',
  owner_email: 'darrinjco@gmail.com',
  mrr_target_cents: 7500,
  source: null,
  region: null,
  queued_at: null,
  next_step: 'Warm intro to Mary Benin',
  next_step_at: '2026-09-21',
  demo_url: 'https://clubmode.ai/demo/abc123',
  notes: null,
  won_at: null,
  lost_at: null,
  lost_reason: null,
  created_at: '2026-09-16T00:00:00Z',
  updated_at: '2026-09-16T00:00:00Z',
};

const CONTACT: Contact = {
  id: 'c1',
  org_id: 'o1',
  full_name: 'Mary Benin',
  title: 'President',
  email: 'mary.benin@gmail.com',
  phone: null,
  role: 'decision maker',
  is_primary: true,
  do_not_contact: false,
  notes: null,
  created_at: '2026-09-16T00:00:00Z',
  updated_at: '2026-09-16T00:00:00Z',
};

const BASE = {
  org: ORG,
  contact: CONTACT,
  repName: 'Darrin Cohen',
  replyTo: 'darrinjco@gmail.com',
  subject: 'A quick question about {{club}}',
  body: 'Hi {{first_name}},\n\nHere is the demo: {{demo_url}}\n\nThanks,\n{{rep_name}}',
  postalAddress: '1 Main St, Walnut Creek, CA 94595',
};

describe('firstNameOf', () => {
  it('takes the first word', () => {
    expect(firstNameOf('Mary Benin')).toBe('Mary');
  });

  it('skips an honorific, because "Hi Dr." is the tell of a broken merge', () => {
    expect(firstNameOf('Dr. Bernie Wolf')).toBe('Bernie');
    expect(firstNameOf('Coach Patty Andrews')).toBe('Patty');
  });

  it('uses a single-word name whole, and survives nothing', () => {
    expect(firstNameOf('Natalee')).toBe('Natalee');
    expect(firstNameOf(null)).toBe('');
  });
});

describe('renderTemplate', () => {
  it('fills every known field', () => {
    const values = mergeValuesFor(ORG, CONTACT, 'Darrin Cohen');
    const out = renderTemplate('{{first_name}} at {{club}}, from {{rep_name}}: {{demo_url}}', values);
    expect(out.text).toBe(
      'Mary at Rossmoor Tennis Club, from The ClubMode Founding Team: https://clubmode.ai/demo/abc123',
    );
    expect(out.missing).toEqual([]);
  });

  it('tolerates whitespace inside the braces', () => {
    const values = mergeValuesFor(ORG, CONTACT, 'Darrin Cohen');
    expect(renderTemplate('Hi {{ first_name }}', values).text).toBe('Hi Mary');
  });

  /*
   * The whole point of `missing`. A field that is empty must stay visible as
   * literal braces in the preview AND block the send — a silently blank
   * "Here is the demo: " is worse than an obvious {{demo_url}}.
   */
  it('reports an empty field and leaves the braces showing', () => {
    const values = mergeValuesFor({ ...ORG, demo_url: null }, CONTACT, 'Darrin Cohen');
    const out = renderTemplate('Here: {{demo_url}}', values);
    expect(out.text).toBe('Here: {{demo_url}}');
    expect(out.missing).toEqual(['demo_url']);
  });

  it('reports a field that does not exist', () => {
    const values = mergeValuesFor(ORG, CONTACT, 'Darrin Cohen');
    const out = renderTemplate('Hi {{firstname}}', values);
    expect(out.text).toBe('Hi {{firstname}}');
    expect(out.missing).toEqual(['firstname']);
  });
});

describe('signatureFor', () => {
  it('carries the rep, the reply address, an opt-out line and the postal address', () => {
    const sig = signatureFor({
      repName: 'Darrin Cohen',
      replyTo: 'darrinjco@gmail.com',
      postalAddress: '1 Main St, Walnut Creek, CA 94595',
    });
    expect(sig).toContain('The ClubMode Founding Team');
    expect(sig).not.toContain('Darrin');
    expect(sig).toContain('ClubMode');
    expect(sig).toContain('darrinjco@gmail.com');
    expect(sig).toContain("Tell us to stop and we won't write again.");
    expect(sig).toContain('1 Main St, Walnut Creek, CA 94595');
  });
});

describe('compose', () => {
  it('renders a sendable message with the signature attached', () => {
    const out = compose(BASE);
    expect(out.blocks).toEqual([]);
    expect(out.to).toBe('mary.benin@gmail.com');
    expect(out.subject).toBe('A quick question about Rossmoor Tennis Club');
    expect(out.text).toContain('Hi Mary,');
    expect(out.text).toContain('https://clubmode.ai/demo/abc123');
    expect(out.text).toContain("Tell us to stop and we won't write again.");
    expect(out.text).toContain('1 Main St, Walnut Creek, CA 94595');
  });

  it('turns a bare URL into a link in the HTML half and escapes everything else', () => {
    const out = compose({ ...BASE, body: 'See https://clubmode.ai/demo/abc123 <script>x</script>' });
    expect(out.html).toContain('<a href="https://clubmode.ai/demo/abc123"');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toContain('<script>');
  });

  // ------------------------------------------------------------ the guards
  it('blocks a contact with no email', () => {
    const out = compose({ ...BASE, contact: { ...CONTACT, email: null } });
    expect(out.blocks).toContain('no_email');
  });

  it('blocks a contact marked do-not-contact, even with an address on file', () => {
    const out = compose({ ...BASE, contact: { ...CONTACT, do_not_contact: true } });
    expect(out.blocks).toContain('do_not_contact');
  });

  it('blocks when there is no postal address — CAN-SPAM is not optional', () => {
    for (const addr of [null, '', '   ']) {
      const out = compose({ ...BASE, postalAddress: addr });
      expect(out.blocks).toContain('no_postal_address');
      // The preview still shows the block, marked, so it is obvious why.
      expect(out.text).toContain('[CRM_POSTAL_ADDRESS not set]');
    }
  });

  it('blocks an unresolved merge field rather than mailing "Hi {{first_name}}"', () => {
    const out = compose({ ...BASE, org: { ...ORG, demo_url: null } });
    expect(out.blocks).toContain('unresolved_merge_fields');
    expect(out.missing).toEqual(['demo_url']);
  });

  it('blocks an empty subject or body', () => {
    expect(compose({ ...BASE, subject: '   ' }).blocks).toContain('no_subject');
    expect(compose({ ...BASE, body: '' }).blocks).toContain('no_body');
  });

  it('reports every reason at once, so one fix does not reveal another', () => {
    const out = compose({
      ...BASE,
      contact: { ...CONTACT, email: null, do_not_contact: true },
      postalAddress: null,
    });
    expect(out.blocks).toEqual(
      expect.arrayContaining(['no_email', 'do_not_contact', 'no_postal_address']),
    );
  });
});

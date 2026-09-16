import { describe, expect, it } from 'vitest';
import { draftEmail, fromTemplate, validate, whyLine, wordCount, type AnthropicLike, type ClubFacts } from './write';

const FACTS: ClubFacts = {
  club: 'Agawam Hunt Club',
  region: 'East',
  firstName: 'Mary',
  contactTitle: null,
  otherContacts: 3,
  city: null,
  state: null,
  website: null,
  repName: 'Darrin Cohen',
};

const TPL = {
  slug: 'outreach-intro',
  subject: 'A question about {{club}}',
  body: 'Hi {{first_name}},\n\nI built a thing. Worth 15 minutes?',
};

/** A letter that breaks none of the rules. */
const GOOD = [
  'Hi Mary,',
  '',
  'I run the tennis program at a club in California. We were paying for software that did about a third of what we needed, so I built our own and it turned into a product.',
  '',
  'It is the club\'s own site, court booking, members finding a fourth, and a QR code at the gate. Two clubs at Rossmoor and Lafayette are running on it.',
  '',
  "If you want, I'll build Agawam Hunt Club's and send you the link. Costs you nothing.",
].join('\n');

describe('the validator', () => {
  it('passes a letter that follows the rules', () => {
    expect(validate(GOOD, FACTS)).toEqual([]);
  });

  it('rejects an empty draft', () => {
    expect(validate('   ', FACTS)).toEqual(['empty']);
  });

  it('rejects a merge field the model left in', () => {
    expect(validate(GOOD.replace('Mary', '{{first_name}}'), FACTS)).toContain('placeholder');
    expect(validate(GOOD.replace('Mary', '[NAME]'), FACTS)).toContain('placeholder');
  });

  it('rejects an invented court count', () => {
    const bad = GOOD.replace('If you want', 'Your six Har-Tru courts are the kind of thing we handle. If you want');
    expect(validate(bad, FACTS)).toContain('invented_fact');
  });

  it('rejects an invented founding year', () => {
    const bad = GOOD.replace('I run', 'A club running since 1924 has different problems. I run');
    expect(validate(bad, FACTS)).toContain('invented_fact');
  });

  it('rejects an invented membership number', () => {
    const bad = GOOD.replace('If you want', 'With your 600 members this matters. If you want');
    expect(validate(bad, FACTS)).toContain('invented_fact');
  });

  it('rejects "I noticed" — the tell of a model pretending to have looked', () => {
    expect(validate(GOOD.replace('Hi Mary,', 'Hi Mary,\n\nI noticed your club online.'), FACTS)).toContain(
      'invented_fact',
    );
  });

  it('rejects a letter that ran long', () => {
    const long = GOOD + '\n\n' + 'padding words here again and again. '.repeat(40);
    expect(validate(long, FACTS)).toContain('too_long');
    expect(wordCount(long)).toBeGreaterThan(150);
  });

  it('rejects a letter that never makes the ask', () => {
    const noOffer = GOOD.replace(/If you want[\s\S]*$/, 'That is all I wanted to say.');
    expect(validate(noOffer, FACTS)).toContain('no_ask');
  });

  it('rejects the salesy wording Darrin banned', () => {
    const salesy = `${GOOD}\n\nWorth 15 minutes?`;
    expect(validate(salesy, FACTS)).toContain('sales_speak');
    expect(validate(GOOD.replace('I built', 'I wanted to reach out about what I built'), FACTS)).toContain('sales_speak');
  });

  it('rejects a letter that forgot the person or the club', () => {
    expect(validate(GOOD.replace('Hi Mary,', 'Hi there,'), FACTS)).toContain('no_name');
    expect(validate(GOOD.replace('Agawam Hunt Club', 'your club'), FACTS)).toContain('no_club');
  });

  it('accepts the club by its short name, the way a person writes it', () => {
    expect(validate(GOOD.replace('Agawam Hunt Club', 'Agawam'), FACTS)).toEqual([]);
  });

  it('rejects markdown, bullets and links nobody asked for', () => {
    expect(validate(GOOD.replace('It is', '- It is'), FACTS)).toContain('markdown');
    expect(validate(GOOD.replace('the link', 'https://clubmode.ai'), FACTS)).toContain('markdown');
    expect(validate(GOOD.replace('I built', '**I built**'), FACTS)).toContain('markdown');
  });

  it('rejects a sign-off, because compose() writes the signature', () => {
    expect(validate(`${GOOD}\n\nBest,\nDarrin`, FACTS)).toContain('signed_off');
  });

  it('collects every problem at once rather than stopping at the first', () => {
    const awful = 'Hi {{first_name}}, I noticed your 6 courts.\n\nBest,';
    expect(validate(awful, FACTS).sort()).toEqual(
      ['invented_fact', 'no_ask', 'no_club', 'no_name', 'placeholder', 'signed_off'].sort(),
    );
  });
});

describe('falling back rather than sending something odd', () => {
  const stub = (body: string, subject = 'A question'): AnthropicLike => ({
    messages: {
      create: async () => ({ content: [{ type: 'tool_use', input: { subject, body } }] }),
    },
  });

  it('keeps a valid draft from the model', async () => {
    const d = await draftEmail(FACTS, TPL, { kind: 'intro', client: stub(GOOD) });
    expect(d.generated_by).toBe('model');
    expect(d.body).toBe(GOOD);
    expect(d.rejected).toBeUndefined();
  });

  it('throws away an invalid draft and sends the plain template instead', async () => {
    const bad = "Hi Mary, I noticed your eight clay courts at Agawam. I'll build yours and send you the link.";
    const d = await draftEmail(FACTS, TPL, { kind: 'intro', client: stub(bad) });
    expect(d.generated_by).toBe('template');
    expect(d.rejected).toContain('invented_fact');
    expect(d.body).toBe('Hi Mary,\n\nI built a thing. Worth 15 minutes?');
  });

  it('falls back when the model returns no subject', async () => {
    const d = await draftEmail(FACTS, TPL, { kind: 'intro', client: stub(GOOD, '') });
    expect(d.generated_by).toBe('template');
  });

  it('falls back when the model call throws — the plan must still exist', async () => {
    const broken: AnthropicLike = {
      messages: {
        create: async () => {
          throw new Error('429');
        },
      },
    };
    const d = await draftEmail(FACTS, TPL, { kind: 'intro', client: broken });
    expect(d.generated_by).toBe('template');
    expect(d.subject).toBe('A question about Agawam Hunt Club');
  });
});

describe('the template merge', () => {
  it('fills every field it uses', () => {
    const d = fromTemplate(TPL, FACTS);
    expect(d.subject).toBe('A question about Agawam Hunt Club');
    expect(d.body).not.toMatch(/\{\{/);
  });
});

describe('the why line', () => {
  it('reads as facts, because it is only facts', () => {
    expect(whyLine(FACTS, { kind: 'intro' })).toBe('East region, 4 contacts, nobody has ever been written to.');
  });

  it('says so when we do not know the region', () => {
    expect(whyLine({ ...FACTS, region: null, otherContacts: 0 }, { kind: 'intro' })).toBe(
      'Region unknown, one contact, nobody has ever been written to.',
    );
  });

  it('includes a place when the row has one', () => {
    expect(whyLine({ ...FACTS, city: 'Providence', state: 'RI' }, { kind: 'intro' })).toContain('Providence, RI');
  });

  it('counts the days on a follow-up', () => {
    expect(whyLine(FACTS, { kind: 'followup', daysSinceFirst: 8 })).toContain('first email 8 days ago, no reply');
  });
});

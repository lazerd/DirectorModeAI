import { describe, it, expect } from 'vitest';
import { setupTasks, type SetupSnapshot } from './setup';

/**
 * The checklist exists to stop the seller becoming the club's developer.
 *
 * So the thing worth testing is not that it renders — it is that a FINISHED
 * club is told nothing. A checklist that always has items on it is a permanent
 * nag, people stop reading it, and they go back to messaging whoever set the
 * site up. Empty when done is the whole contract.
 */

const done: SetupSnapshot = {
  siteStatus: 'published',
  publishedClasses: 4,
  draftClasses: 0,
  unpricedPublishedClasses: 0,
  partnersWithoutUrl: 0,
  documentsWithoutFile: 0,
  staffCount: 3,
  chargingWithNoCheckout: false,
  hasHeroImage: true,
  hasCourtRates: true,
};

describe('setupTasks', () => {
  it('says nothing at all to a club that has finished', () => {
    expect(setupTasks(done)).toEqual([]);
  });

  it('puts money ahead of appearance', () => {
    // A club losing income and missing a photo should be told about the income.
    const tasks = setupTasks({ ...done, chargingWithNoCheckout: true, hasHeroImage: false });
    expect(tasks[0].id).toBe('checkout');
    expect(tasks[0].severity).toBe('money');
    expect(tasks[tasks.length - 1].id).toBe('hero');
  });

  it('describes Lafayette exactly as it stands today', () => {
    // The real snapshot: published site, one published class with no price,
    // three drafts, two pros with no URL, a packet with no file, no checkout.
    const tasks = setupTasks({
      siteStatus: 'published',
      publishedClasses: 1,
      draftClasses: 3,
      unpricedPublishedClasses: 1,
      partnersWithoutUrl: 2,
      documentsWithoutFile: 1,
      staffCount: 1,
      chargingWithNoCheckout: true,
      hasHeroImage: false,
      hasCourtRates: true,
    });
    expect(tasks.map((t) => t.id)).toEqual([
      'checkout',
      'prices',
      'drafts',
      'partners',
      'documents',
      'hero',
    ]);
    // Counted, so it reads as a job rather than a warning.
    expect(tasks.find((t) => t.id === 'drafts')?.title).toBe('Check and publish 3 draft classes');
    expect(tasks.find((t) => t.id === 'partners')?.title).toContain('2 of your other pros');
  });

  it('singularises one of a thing', () => {
    const one = setupTasks({
      ...done,
      unpricedPublishedClasses: 1,
      draftClasses: 1,
      partnersWithoutUrl: 1,
      documentsWithoutFile: 1,
    });
    expect(one.find((t) => t.id === 'prices')?.title).toBe('Set the price on 1 class');
    expect(one.find((t) => t.id === 'drafts')?.title).toBe('Check and publish 1 draft class');
    expect(one.find((t) => t.id === 'documents')?.title).toBe('Upload 1 missing document');
  });

  it('asks for a first class rather than nagging about drafts', () => {
    // Nothing published and three drafts is a club that has not started, not a
    // club with a backlog — and "your programs page is empty" is the fact that
    // matters.
    const tasks = setupTasks({ ...done, publishedClasses: 0, draftClasses: 3 });
    expect(tasks.map((t) => t.id)).toContain('first-class');
    expect(tasks.map((t) => t.id)).not.toContain('drafts');
  });

  it('offers a sentence to say to the assistant where one makes sense', () => {
    // The point of the ask is that the club never has to find the screen. But
    // a payment URL or a photo cannot be dictated, so those offer none rather
    // than pretending.
    const tasks = setupTasks({
      ...done,
      unpricedPublishedClasses: 2,
      chargingWithNoCheckout: true,
      hasHeroImage: false,
    });
    expect(tasks.find((t) => t.id === 'prices')?.ask).toBeTruthy();
    expect(tasks.find((t) => t.id === 'checkout')?.ask).toBeNull();
    expect(tasks.find((t) => t.id === 'hero')?.ask).toBeNull();
  });

  it('every task points at a real editor screen', () => {
    const all = setupTasks({
      siteStatus: 'draft',
      publishedClasses: 0,
      draftClasses: 0,
      unpricedPublishedClasses: 3,
      partnersWithoutUrl: 1,
      documentsWithoutFile: 1,
      staffCount: 0,
      chargingWithNoCheckout: true,
      hasHeroImage: false,
      hasCourtRates: false,
    });
    const screens = ['/run/site', '/run/site/classes', '/run/site/courts', '/run/site/payments'];
    for (const task of all) expect(screens).toContain(task.href);
    // And a brand-new club really does get told everything.
    expect(all.length).toBeGreaterThanOrEqual(7);
  });
});

/**
 * What is still unfinished on a club's site, and whose job it is.
 *
 * This exists because of a business risk, not a technical one. The pitch is
 * "you change your own skip dates and prices instead of paying someone" — and
 * then the club owner lands on a long editor with no indication of what is
 * incomplete, scrolls, gives up, and messages whoever set it up. Do that twice
 * and you have become the developer they were trying to stop paying, except
 * now for a subscription.
 *
 * So the unfinished work is NAMED, counted from real rows, and addressed to
 * them. A task with a number on it and a link to the exact screen is a job
 * someone does; a blank editor is a job someone delegates.
 *
 * Deliberately not a progress bar or a score. Every item is a real thing that
 * is wrong on a public page right now, in the order a visitor would notice it
 * — see [[feedback_insight_over_dashboard]] in spirit: say the thing, don't
 * chart it.
 *
 * Pure over a snapshot the caller has already fetched, so it is testable
 * without a database.
 */

export type SetupSnapshot = {
  siteStatus: string;
  /** Published classes that anyone can see right now. */
  publishedClasses: number;
  draftClasses: number;
  /** Classes whose price nobody has set — these show "Price on request". */
  unpricedPublishedClasses: number;
  partnersWithoutUrl: number;
  documentsWithoutFile: number;
  staffCount: number;
  /** Selling something with no way to take the money. */
  chargingWithNoCheckout: boolean;
  hasHeroImage: boolean;
  hasCourtRates: boolean;
};

export type SetupTask = {
  id: string;
  /** Addressed to the club, in their words, never ours. */
  title: string;
  detail: string;
  href: string;
  /** What to type at the assistant instead of hunting for the screen. */
  ask: string | null;
  /**
   * 'public' — a visitor can see this is wrong today.
   * 'money' — it is costing the club.
   * 'polish' — worth doing, nobody is harmed.
   */
  severity: 'money' | 'public' | 'polish';
};

const ORDER: Record<SetupTask['severity'], number> = { money: 0, public: 1, polish: 2 };

export function setupTasks(s: SetupSnapshot): SetupTask[] {
  const t: SetupTask[] = [];

  // Money first: this is the club losing income, not looking untidy.
  if (s.chargingWithNoCheckout) {
    t.push({
      id: 'checkout',
      title: 'Add the link people pay you through',
      detail:
        'You are charging for court time or classes, but every confirmation says "settle up at the desk" — so people are booking without paying. Paste your Square, PayPal or Venmo link and they each get a Pay now button.',
      href: '/run/site/payments',
      ask: null, // A payment URL is the club's own; it must be pasted, not dictated.
      severity: 'money',
    });
  }

  if (s.unpricedPublishedClasses > 0) {
    t.push({
      id: 'prices',
      title:
        s.unpricedPublishedClasses === 1
          ? 'Set the price on 1 class'
          : `Set prices on ${s.unpricedPublishedClasses} classes`,
      detail:
        'Until you do, the class says "Price on request" and people have to call you to find out what it costs.',
      href: '/run/site/classes',
      ask: 'Set the price of the after-school class to $240',
      severity: 'money',
    });
  }

  // Then what a visitor sees as wrong.
  if (s.siteStatus !== 'published') {
    t.push({
      id: 'publish',
      title: 'Publish your site',
      detail:
        'It is live at its address but hidden from Google, and anyone you send the link to can already read it.',
      href: '/run/site',
      ask: 'Publish the club site',
      severity: 'public',
    });
  }

  if (s.publishedClasses === 0) {
    t.push({
      id: 'first-class',
      title: 'Publish your first class',
      detail:
        'Your programs page is empty, so nobody can sign up for anything yet.',
      href: '/run/site/classes',
      ask: 'What classes do I have, and which are published?',
      severity: 'public',
    });
  } else if (s.draftClasses > 0) {
    t.push({
      id: 'drafts',
      title:
        s.draftClasses === 1
          ? 'Check and publish 1 draft class'
          : `Check and publish ${s.draftClasses} draft classes`,
      detail:
        'They are not on your site yet. Check the days and times are right first — then publish them.',
      href: '/run/site/classes',
      ask: 'Publish the adult clinics class',
      severity: 'public',
    });
  }

  if (s.partnersWithoutUrl > 0) {
    t.push({
      id: 'partners',
      title:
        s.partnersWithoutUrl === 1
          ? 'Add the web address for 1 of your other pros'
          : `Add web addresses for ${s.partnersWithoutUrl} of your other pros`,
      detail:
        'They are listed on your site but there is nowhere to send people, so the card does not link anywhere.',
      href: '/run/site',
      ask: null,
      severity: 'public',
    });
  }

  if (s.documentsWithoutFile > 0) {
    t.push({
      id: 'documents',
      title:
        s.documentsWithoutFile === 1
          ? 'Upload 1 missing document'
          : `Upload ${s.documentsWithoutFile} missing documents`,
      detail:
        'It is listed but has no file attached, so it is hidden from your site rather than offering a download that does nothing.',
      href: '/run/site',
      ask: null,
      severity: 'public',
    });
  }

  // Then the things worth doing that harm nobody.
  if (!s.hasCourtRates) {
    t.push({
      id: 'rates',
      title: 'Set your court rates',
      detail:
        'Say what members and the public pay, and at what times. Until you do, nobody can book a court online.',
      href: '/run/site/courts',
      ask: 'Make public court time $24 an hour',
      severity: 'polish',
    });
  }

  if (s.staffCount === 0) {
    t.push({
      id: 'staff',
      title: 'Add your pros',
      detail: 'Names and photos of the people who teach — the page people most often read.',
      href: '/run/site',
      ask: null,
      severity: 'polish',
    });
  }

  if (!s.hasHeroImage) {
    t.push({
      id: 'hero',
      title: 'Add a photo of the club',
      detail: 'One good picture of the courts does more than any amount of writing.',
      href: '/run/site',
      ask: null,
      severity: 'polish',
    });
  }

  return t.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}

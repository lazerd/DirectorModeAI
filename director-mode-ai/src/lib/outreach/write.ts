/**
 * Writing one cold email.
 *
 * ── WHY THIS IS NOT A MAIL MERGE ────────────────────────────────────────
 * The same list has already been mailed once, generically, on a different
 * product: six DCA clubs, zero replies. A template with {{club}} in it is a
 * template with {{club}} in it, and a club president reads that in one second.
 * So each card is written for its club by the model — and then checked by
 * code, because the failure mode of a model writing sales email to 500 clubs
 * it knows nothing about is that it makes things up about them.
 *
 * ── THE FACT BOUNDARY ───────────────────────────────────────────────────
 * The model is given exactly what we actually know — the club's name, its
 * region, the contact's first name, how many other people we have there, and
 * a city/state or website when the row has one — and told those are the only
 * club facts that exist. Everything else in the letter is about US: what we
 * built, who is running it, the ask.
 *
 * ── THE VALIDATOR IS THE GATE ───────────────────────────────────────────
 * validate() is deterministic and runs on every generated body. It rejects
 * unfilled placeholders, invented specifics ("your six courts", "since 1924",
 * "I noticed that..."), anything over the word budget, and anything missing
 * the ask. A rejected draft does NOT get retried into something odd — it
 * falls back to the plain template, which is always safe and always sendable.
 * A slightly generic email that is true beats a personal one that is wrong.
 */

import Anthropic from '@anthropic-ai/sdk';
import { firstNameOf, renderTemplate, type MergeValues } from '@/lib/crm/compose';

/**
 * Its own variable, matching the rest of the app: the writing model, not the
 * agent default and not the vision default.
 */
const MODEL = process.env.AI_MODEL_WRITER ?? 'claude-opus-5';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;

/** Over this and it stops reading like a note and starts reading like a pitch. */
export const MAX_WORDS = 150;

/** Everything true we know about one club, and nothing else. */
export interface ClubFacts {
  club: string;
  region: string | null;
  firstName: string;
  contactTitle: string | null;
  otherContacts: number;
  city: string | null;
  state: string | null;
  website: string | null;
  repName: string;
}

export interface Draft {
  subject: string;
  body: string;
  generated_by: 'model' | 'template';
  /** Why the model's draft was thrown away, when it was. */
  rejected?: string[];
}

// ---------------------------------------------------------------- validator

export type Violation =
  | 'empty'
  | 'placeholder'
  | 'too_long'
  | 'no_ask'
  | 'sales_speak'
  | 'no_name'
  | 'no_club'
  | 'invented_fact'
  | 'markdown'
  | 'signed_off';

export const VIOLATION_TEXT: Record<Violation, string> = {
  empty: 'came back empty',
  placeholder: 'left a placeholder unfilled',
  too_long: `ran over ${MAX_WORDS} words`,
  no_ask: 'never offered to build them one',
  sales_speak: 'used a salesy phrase we have banned',
  no_name: "did not use the contact's first name",
  no_club: 'never named the club',
  invented_fact: 'invented something about the club',
  markdown: 'used markdown or a link we did not give it',
  signed_off: 'wrote its own signature',
};

/**
 * Specifics nobody told us.
 *
 * These are the shapes a model reaches for when it wants a cold email to feel
 * personal and has nothing to be personal about: a court count, a founding
 * year, a membership size, or the tell-tale "I noticed". We know none of those
 * things about 519 of these clubs, so any of them is a fabrication by
 * definition — there is no true version of the sentence to keep.
 */
const INVENTED = [
  /\bI (?:noticed|saw|see|read|came across|was looking at|happened to)\b/i,
  /\byour (?:\d+|one|two|three|four|five|six|eight|ten|twelve)[- ]?(?:court|har-tru|clay|hard|indoor|outdoor)/i,
  /\b(?:\d+|one|two|three|four|five|six|eight|ten|twelve)\s+(?:tennis|pickleball|paddle|platform)?\s*courts?\b/i,
  /\bsince\s+(?:1[6-9]|20)\d{2}\b/i,
  /\bfounded\s+in\b/i,
  /\byour\s+\d[\d,]*\s+(?:members|families|juniors|players)\b/i,
  /\byour (?:junior|adult|league|USTA|cardio|summer|winter) program\b/i,
  /\b(?:looks? like|seems? like|sounds? like) (?:you|your club)\b/i,
];

/**
 * The phrases that give a sales email away.
 *
 * Darrin's rule, on reading the first draft: "Stuff like 'Worth 15 minutes?'
 * is so AI salesly awful… messages need to be from the heart." A letter asking
 * a stranger for a meeting is a sales email. A letter offering to build their
 * club something, free, whether or not they ever pay, is a gift — so the ask
 * became the offer, and the meeting-request wording is banned outright.
 */
const SALES_SPEAK = [
  /\bworth \d+ minutes\b/i,
  /\b(?:quick|brief) (?:question|call|chat)\b/i,
  /\breach(?:ing)? out\b/i,
  /\bcircle back\b/i,
  /\btouch(?:ing)? base\b/i,
  /\bhope (?:this|you)[^.]{0,30}(?:finds you well|are well|doing well)\b/i,
  /\b(?:solutions?|leverage|streamline|synergy|value prop|pain points?|ROI|onboarding experience)\b/i,
  /\bexcited to\b/i,
  /\blet me know if you(?:'re| are) interested\b/i,
  /\b(?:book|schedule|hop on|jump on) a (?:call|demo|time)\b/i,
  /\bgame[- ]chang(?:er|ing)\b/i,
  /\bI help \w+ clubs\b/i,
];

/** Things a model adds that turn a note back into a campaign. */
const MARKUP = [/\[[^\]]+\]\([^)]+\)/, /^\s*[*-]\s+/m, /\*\*/, /^#{1,6}\s/m, /https?:\/\//i];

/** The model writes the letter; compose() writes the sign-off. Never both. */
const SIGN_OFF = /^\s*(?:--\s*$|best[,.]?\s*$|thanks[,.]?\s*$|cheers[,.]?\s*$|sincerely[,.]?\s*$|regards[,.]?\s*$)/im;

export function wordCount(s: string): number {
  return (s.trim().match(/\S+/g) || []).length;
}

/**
 * Everything wrong with a draft, as a list. Empty means it may be sent.
 *
 * Takes the facts rather than reading anything, so a test can hand it a body
 * and a club name and get an answer with no database and no model.
 */
export function validate(body: string, facts: ClubFacts): Violation[] {
  const out: Violation[] = [];
  const text = (body ?? '').trim();
  if (!text) return ['empty'];

  if (/\{\{|\}\}|\[(?:club|name|first_name|your|insert)[^\]]*\]|__+/i.test(text)) out.push('placeholder');
  if (wordCount(text) > MAX_WORDS) out.push('too_long');
  // The offer IS the ask: he builds their club's site and sends the link,
  // free, the way Rossmoor and Lafayette got theirs. A letter that describes
  // the product and stops has nothing in it for the person reading.
  const offersToBuild = /\bbuild\b/i.test(text);
  const offersToShow = /\b(?:send you the link|send it to you|send you a link|link to it|have a look|look at it|see it)\b/i.test(text);
  if (!offersToBuild || !offersToShow) out.push('no_ask');
  if (SALES_SPEAK.some((re) => re.test(text))) out.push('sales_speak');
  if (facts.firstName && !new RegExp(`\\b${escapeRe(facts.firstName)}\\b`, 'i').test(text)) out.push('no_name');
  if (facts.club && !clubMentioned(text, facts.club)) out.push('no_club');
  if (INVENTED.some((re) => re.test(text))) out.push('invented_fact');
  if (MARKUP.some((re) => re.test(text))) out.push('markdown');
  if (SIGN_OFF.test(text)) out.push('signed_off');
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "Aberdeen Golf and Country Club" is often written "Aberdeen" in a real
 * sentence, and insisting on the full legal name would reject good letters.
 * The first substantial word of the name is enough to prove the model knew
 * which club it was writing to.
 */
function clubMentioned(text: string, club: string): boolean {
  if (new RegExp(escapeRe(club), 'i').test(text)) return true;
  const head = club.split(/\s+/).find((w) => w.length > 3 && !/^(the|club|golf|and|tennis)$/i.test(w));
  return !!head && new RegExp(`\\b${escapeRe(head)}`, 'i').test(text);
}

// ----------------------------------------------------------- the fallback

export interface TemplateRow {
  slug: string;
  subject: string;
  body: string;
}

/** Merge values for the outreach templates. Only fields compose() knows. */
export function valuesFor(facts: ClubFacts): MergeValues {
  return {
    first_name: facts.firstName,
    club: facts.club,
    rep_name: facts.repName,
    demo_url: '',
    next_step: '',
  };
}

/**
 * The plain letter. Same words the model is shown, merged rather than written.
 * Always produces something sendable — this is what "fall back rather than
 * send something odd" actually falls back to.
 */
export function fromTemplate(tpl: TemplateRow, facts: ClubFacts): Draft {
  const values = valuesFor(facts);
  return {
    subject: renderTemplate(tpl.subject, values).text.trim(),
    body: renderTemplate(tpl.body, values).text.trim(),
    generated_by: 'template',
  };
}

// --------------------------------------------------------------- the why

/**
 * The one line above the email: why this club, why now.
 *
 * Deterministic, not generated. Every clause is a fact already in the row, so
 * a model could only get it wrong — and the whole value of the line is that
 * the rep can trust it at a glance while deciding in two seconds.
 */
export function whyLine(facts: ClubFacts, opts: { kind: 'intro' | 'followup'; daysSinceFirst?: number }): string {
  const bits: string[] = [];
  bits.push(facts.region ? `${facts.region} region` : 'Region unknown');
  const place = [facts.city, facts.state].filter(Boolean).join(', ');
  if (place) bits.push(place);
  const total = facts.otherContacts + 1;
  bits.push(total === 1 ? 'one contact' : `${total} contacts`);
  if (opts.kind === 'followup') {
    bits.push(`first email ${opts.daysSinceFirst ?? 0} days ago, no reply`);
  } else {
    bits.push('nobody has ever been written to');
  }
  const line = bits.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1) + '.';
}

// -------------------------------------------------------------- the model

const SYSTEM = [
  'You write one short cold email at a time, from a tennis director in California to a person at another racquet club.',
  '',
  'Who is writing: he is the tennis director at a club in Orinda, California. Not a software person — he started building this because he was spending Sunday nights making draw sheets in Excel and answering forty texts about who was playing at nine. It turned into the club\'s own website, court sign-ups, members finding each other a fourth, captain tools for league teams, and a QR code on the fence so nobody argues about whose court it is.',
  '',
  'The story he can tell, and it is true: last month he built one for a club of 200 players in their seventies and eighties who run everything off a whiteboard and a paper sign-in sheet at the kiosk. Their tournament director had been nursing the same pairings spreadsheet for years. Watching him press one button and get his round sheets was the most fun the sender has had doing this. Lafayette Tennis Club has one too. He built both before anyone paid him anything.',
  '',
  'THE ASK IS A GIFT, NOT A MEETING. The letter ends by offering to build THEIR club\'s one and send them the link — free, whether or not they ever pay, because he would just like them to see it. Never ask for a call, a meeting, a demo, or minutes of their time.',
  '',
  'RULES, all of them hard:',
  '- The ONLY facts you know about the recipient\'s club are the ones in the Facts block. You do not know their court count, their surface, their founding year, their membership, their programs, their weather, or their season. Never imply you have looked at their club, their website or their schedule. Never open with "I noticed" or "I saw".',
  `- Under ${MAX_WORDS} words. Shorter is better. Three or four short paragraphs.`,
  '- Open "Hi <first name>," on its own line.',
  '- Name the club once, naturally, the way a person would say it out loud.',
  '- End by offering to build their club\'s and send them the link, in his own words, saying plainly that it costs them nothing and he will do it whether or not they ever pay him. Something like: "If you want, I\'ll build <club>\'s and send you the link." NEVER "Worth 15 minutes?", never any request for a call or a meeting.',
  '- Say one true, human thing about why he made it or what it was like watching someone use it. A letter with no feeling in it is a brochure. Do not manufacture emotion about THEIR club — the feeling is his, about his own work.',
  '- Banned outright, they read as sales: "worth 15 minutes", "quick question", "reaching out", "circle back", "touching base", "hope this finds you well", "solutions", "leverage", "streamline", "excited to", "let me know if you\'re interested", "book a call", "game-changer".',
  '- No sign-off, no name at the end, no "--". A signature is added after you.',
  '- Plain text. No markdown, no bullet points, no bold, no links, no URLs.',
  '- No subject-line clichés: no "Quick question", no "Following up", no "Touching base", no all-caps, no emoji, no exclamation marks.',
  '- Do not list features. Name two or three of the things above at most, in a sentence, because they happen to be the ones that fit.',
  '- Write like a person typing an email between lessons, not like marketing. Contractions. Short sentences. No "I hope this finds you well", no "I wanted to reach out", no "solutions", no "streamline", no "leverage", no "excited to".',
  '',
  'Call write_email exactly once.',
].join('\n');

function factsBlock(facts: ClubFacts, kind: 'intro' | 'followup', priorBody?: string): string {
  const lines = [
    `Club: ${facts.club}`,
    `Recipient first name: ${facts.firstName}`,
    facts.contactTitle ? `Their title, as the directory lists it: ${facts.contactTitle}` : null,
    facts.region ? `Region: ${facts.region}` : 'Region: not recorded',
    facts.city || facts.state ? `Where: ${[facts.city, facts.state].filter(Boolean).join(', ')}` : null,
    facts.website ? `Their website: ${facts.website} (do NOT put this or any URL in the email)` : null,
    facts.otherContacts > 0
      ? `We also have ${facts.otherContacts} other ${facts.otherContacts === 1 ? 'person' : 'people'} at this club on file, but this letter goes to one person only — never mention the others.`
      : 'This is the only person we have at this club.',
    `Sender's name: ${facts.repName}`,
  ].filter(Boolean);
  if (kind === 'followup' && priorBody) {
    lines.push(
      '',
      'This is the ONE follow-up, about a week after the first email, which got no reply. Be brief — four sentences at most — say plainly that this is the last time you will write, and repeat the offer to build their site. The first email said:',
      '"""',
      priorBody.slice(0, 1200),
      '"""',
    );
  }
  return lines.join('\n');
}

/**
 * Ask the model for one letter, check it, and hand back whichever of the two
 * is safe to send.
 *
 * Never throws and never returns nothing: an API outage, a rate limit or a
 * refusal all end in the plain template, because the morning plan must exist
 * whether or not the writer was available.
 */
export async function draftEmail(
  facts: ClubFacts,
  tpl: TemplateRow,
  opts: { kind: 'intro' | 'followup'; priorBody?: string; client?: AnthropicLike } = { kind: 'intro' },
): Promise<Draft> {
  const fallback = fromTemplate(tpl, facts);
  const client = opts.client ?? (ANTHROPIC_KEY ? (new Anthropic({ apiKey: ANTHROPIC_KEY }) as unknown as AnthropicLike) : null);
  if (!client) return fallback;

  let msg: { content?: { type: string; input?: unknown }[] };
  try {
    msg = (await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM,
      tools: [
        {
          name: 'write_email',
          description: 'Return the drafted cold email for a rep to read and swipe on.',
          input_schema: {
            type: 'object',
            properties: {
              subject: {
                type: 'string',
                description:
                  'Subject line, under 55 characters, lower-key than a marketing subject. It may name the club.',
              },
              body: {
                type: 'string',
                description: 'The message. Paragraphs separated by a blank line. No sign-off.',
              },
            },
            required: ['subject', 'body'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'write_email' },
      messages: [{ role: 'user', content: `Facts:\n${factsBlock(facts, opts.kind, opts.priorBody)}` }],
    })) as { content?: { type: string; input?: unknown }[] };
  } catch {
    // Rate limit, outage, anything. The plain letter is already written.
    return fallback;
  }

  const block = (msg?.content || []).find((b) => b.type === 'tool_use');
  const out = (block?.input ?? {}) as { subject?: unknown; body?: unknown };
  const body = typeof out.body === 'string' ? out.body.trim() : '';
  const subject = typeof out.subject === 'string' ? out.subject.trim() : '';

  const problems = validate(body, facts);
  if (problems.length || !subject) {
    return { ...fallback, rejected: problems.length ? problems : ['empty'] };
  }
  return { subject: subject.slice(0, 200), body, generated_by: 'model' };
}

/** The slice of the SDK this module uses. Lets a test hand in a fake. */
export interface AnthropicLike {
  messages: { create(args: Record<string, unknown>): Promise<unknown> };
}

export { firstNameOf };

/**
 * Public SMS programme page + opt-in form.
 *
 * Built for A2P 10DLC campaign review (the first submission was rejected with
 * 30909 because the reviewer could not find the opt-in — it lived inside a
 * court-booking modal). This page is the CTA URL given to Twilio: it shows the
 * programme, sample messages, every opt-in path and a working opt-in form.
 *
 * Must stay public — never add /sms to middleware's protectedPaths.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import SmsOptInForm from './SmsOptInForm';

export const metadata: Metadata = {
  title: 'Text messages from ClubMode — sign up',
  description:
    'Get match lineups, confirmations and match-day messages from your club or team by text. How to opt in, what we send, and how to stop.',
  alternates: { canonical: '/sms' },
};

const CONTACT = 'hello@clubmode.ai';

const SAMPLES = [
  "ClubMode: Fall B2/B3 lineup for Wed 9/30 9:30am vs Orinda CC is out. You're on court 1 with Shannon. Confirm: clubmode.ai/captain/confirm/abc123. Reply STOP to opt out.",
  'ClubMode: Reminder: your match is tomorrow at 9:30am at Sleepy Hollow. Please arrive 15 min early. Reply STOP to opt out.',
  "ClubMode match chat (Wed 9/30) Robyn: Running 5 min late, warm up without me! (Reply to message the players in today's match. STOP to opt out.)",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-9">
      <h2 className="text-lg font-display text-white">{title}</h2>
      <div className="mt-2 space-y-3 text-white/65 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

export default function SmsPage() {
  return (
    <div className="min-h-screen bg-[#001820]">
      <div className="max-w-2xl mx-auto px-6 py-14">
        <Link href="/" className="text-white/40 text-sm hover:text-white">
          ← ClubMode
        </Link>

        <h1 className="text-3xl font-display text-white mt-4">Text messages from ClubMode</h1>
        <p className="mt-4 text-white/65 text-[15px] leading-relaxed">
          ClubMode (<span className="text-white/85">clubmode.ai</span>) runs tennis clubs, leagues and
          teams. Players can choose to get their team&rsquo;s match information by text instead of
          digging through email. Texting is <strong className="text-white/85">opt-in only</strong>,
          and you can stop at any time by replying STOP.
        </p>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="text-lg font-display text-white">Sign up for texts</h2>
          <p className="mt-1 text-white/50 text-sm">US mobile numbers only.</p>
          <SmsOptInForm />
        </div>

        <Section title="What we send">
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Match lineups and court assignments</li>
            <li>Requests to confirm you&rsquo;ll be at a match</li>
            <li>Schedule changes, rain-outs and reminders</li>
            <li>
              A match-day group thread with only the players in your match (running late, parking,
              court changes)
            </li>
          </ul>
          <p>
            No marketing or promotional texts.{' '}
            <strong className="text-white/85">Message frequency varies</strong> with your
            team&rsquo;s schedule, typically one to four messages per match during a season and none
            outside it. <strong className="text-white/85">Message and data rates may apply.</strong>
          </p>
        </Section>

        <Section title="Sample messages">
          <div className="space-y-2.5">
            {SAMPLES.map((s) => (
              <div
                key={s}
                className="rounded-2xl rounded-bl-sm bg-white/[0.06] border border-white/10 px-4 py-3 text-sm text-white/80"
              >
                {s}
              </div>
            ))}
          </div>
        </Section>

        <Section title="Ways to opt in">
          <p>Every path uses an unchecked box you tick yourself. We never opt anyone in for them.</p>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>
              <strong className="text-white/85">This page:</strong> fill in the form above and tick
              the consent box.
            </li>
            <li>
              <strong className="text-white/85">Booking a court or joining a game</strong> on a
              club&rsquo;s public court sheet (for example{' '}
              <Link href="/courtsheet/sleepy-hollow" className="text-[#D3FB52] hover:underline">
                clubmode.ai/courtsheet/sleepy-hollow
              </Link>
              ): tick &ldquo;Text me a confirmation&rdquo; and enter your mobile number.
            </li>
            <li>
              <strong className="text-white/85">From your team captain:</strong> captains send
              players the link to this page. A captain cannot opt a player in; the player signs up
              here.
            </li>
          </ol>
        </Section>

        <Section title="How to stop, and help">
          <p>
            Reply <strong className="text-white/85">STOP</strong> to any message to stop all texts
            immediately. You&rsquo;ll get one confirmation and nothing after that. Reply{' '}
            <strong className="text-white/85">START</strong> to resume. Reply{' '}
            <strong className="text-white/85">HELP</strong> for help, or email{' '}
            <a href={`mailto:${CONTACT}`} className="text-[#D3FB52] hover:underline">
              {CONTACT}
            </a>
            . Stopping texts never removes you from your team; your captain can still reach you by
            email.
          </p>
          <p>Carriers are not liable for delayed or undelivered messages.</p>
        </Section>

        <Section title="Your number">
          <p>
            Mobile numbers and opt-in consent are never shared with or sold to third parties or
            affiliates for marketing or promotional purposes. They are used only to send the
            messages described here. See our{' '}
            <Link href="/terms" className="text-[#D3FB52] hover:underline">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-[#D3FB52] hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </Section>
      </div>
    </div>
  );
}

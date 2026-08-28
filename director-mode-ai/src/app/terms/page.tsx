/**
 * Public terms of service.
 *
 * Carriers read this page as part of A2P 10DLC campaign review, so the SMS
 * section has to state the programme, the frequency, "message and data rates
 * may apply", and how to stop. Those are marked below — do not edit them away.
 *
 * Public by default: /terms is not in middleware's protectedPaths, and it must
 * never be added — a login wall here fails the carrier check.
 */
import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service · ClubMode',
  description:
    'The terms covering use of ClubMode, including the team text-messaging programme.',
};

const UPDATED = 'August 28, 2026';
const CONTACT = 'darrinjco@gmail.com';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-display text-white">{title}</h2>
      <div className="mt-2 space-y-3 text-white/65 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#001820]">
      <div className="max-w-2xl mx-auto px-6 py-14">
        <Link href="/" className="text-white/40 text-sm hover:text-white">
          ← ClubMode
        </Link>

        <h1 className="text-3xl font-display text-white mt-4">Terms of Service</h1>
        <p className="text-white/40 text-sm mt-1">Last updated {UPDATED}</p>

        <p className="mt-6 text-white/65 text-[15px] leading-relaxed">
          These terms cover your use of ClubMode (
          <span className="text-white/85">club.coachmode.ai</span>), software for running
          racquet-sports clubs, leagues and teams. By using the service you agree to them.
        </p>

        <Section title="The service">
          <p>
            ClubMode lets club staff and league captains manage rosters, court schedules, programs,
            events and league matches, and contact their own members by email and text message about
            that activity.
          </p>
        </Section>

        <Section title="Accounts">
          <p>
            You are responsible for what happens under your account and for keeping your sign-in
            details to yourself. Tell us promptly if you think someone else has access.
          </p>
        </Section>

        <Section title="Your members&rsquo; information">
          <p>
            When you add players to a roster you are responsible for having the right to hold their
            contact details and to contact them about club and team activity. Use the service only
            to reach people who gave you their details for that purpose.
          </p>
          <p>
            Do not use ClubMode to send unsolicited marketing, or to contact anyone who has asked
            you to stop.
          </p>
        </Section>

        {/*
          The SMS programme terms the A2P 10DLC review checks for: what the
          programme is, frequency, rates disclosure, and how to stop.
        */}
        <Section title="Text messaging">
          <p>
            Clubs and captains can send text messages to players on their own roster about that
            team&rsquo;s activity: court assignments, lineup changes, confirmation requests,
            schedule changes and reminders. Players provide their mobile number to their club or
            captain for this purpose.
          </p>
          <p>
            <strong className="text-white/85">Message frequency varies</strong> with your
            team&rsquo;s schedule — typically one to four messages per match during a season, and
            none outside it.
          </p>
          <p>
            <strong className="text-white/85">Message and data rates may apply.</strong> Carriers
            are not liable for delayed or undelivered messages.
          </p>
          <p>
            Reply <strong className="text-white/85">STOP</strong> at any time to stop receiving
            texts, and <strong className="text-white/85">HELP</strong> for help. You can also write
            to{' '}
            <a href={`mailto:${CONTACT}`} className="text-[#D3FB52] hover:underline">
              {CONTACT}
            </a>
            . Stopping texts does not remove you from your team — your captain can still reach you
            by email.
          </p>
          <p>
            Mobile numbers are never shared or sold to third parties for marketing. See the{' '}
            <Link href="/privacy" className="text-[#D3FB52] hover:underline">
              Privacy Policy
            </Link>
            .
          </p>
        </Section>

        <Section title="Fees">
          <p>
            Some features require a paid subscription. Subscription fees are billed in advance for
            the period you choose and are not refundable for a period already begun, except where
            the law requires otherwise. You can cancel at any time; the subscription then runs to
            the end of the current period.
          </p>
        </Section>

        <Section title="Acceptable use">
          <p>
            Do not attempt to reach another club&rsquo;s data, disrupt the service, or use it to
            break the law or send anything unlawful, abusive or deceptive.
          </p>
        </Section>

        <Section title="Availability and liability">
          <p>
            The service is provided as-is. We work to keep it running but do not guarantee it will
            be uninterrupted or error-free, and we are not liable for indirect or consequential
            loss. Nothing here limits liability that cannot be limited by law.
          </p>
          <p>
            You remain responsible for the decisions you make with the service — a lineup, a
            schedule and a message are yours, not ours.
          </p>
        </Section>

        <Section title="Ending it">
          <p>
            You may stop using the service at any time and ask us to delete your data. We may
            suspend an account that breaks these terms, and will tell you why where we can.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update these terms; the date above changes when we do, and we will tell you
            directly about anything material.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            <a href={`mailto:${CONTACT}`} className="text-[#D3FB52] hover:underline">
              {CONTACT}
            </a>
          </p>
        </Section>

        <p className="mt-10 text-white/30 text-sm">
          See also our{' '}
          <Link href="/privacy" className="text-white/50 hover:text-white underline">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

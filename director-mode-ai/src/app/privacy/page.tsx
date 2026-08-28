/**
 * Public privacy policy.
 *
 * Carriers read this page. An A2P 10DLC campaign registration is rejected
 * without a reachable privacy policy that carries three specific things: an
 * explicit statement that mobile numbers are never shared or sold, the message
 * frequency, and a "message and data rates may apply" disclosure. Those three
 * are marked in the source below — do not edit them away to tighten the prose.
 *
 * Everything here has to stay TRUE of what the code actually does. If ClubMode
 * starts sharing data with a processor not listed under "Who else sees it",
 * this page changes in the same commit.
 *
 * Public by default: /privacy is not in middleware's protectedPaths, and it
 * must never be added — a login wall here fails the carrier check.
 */
import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy · ClubMode',
  description:
    'How ClubMode handles club, player and contact information, including mobile numbers used for team messaging.',
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

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#001820]">
      <div className="max-w-2xl mx-auto px-6 py-14">
        <Link href="/" className="text-white/40 text-sm hover:text-white">
          ← ClubMode
        </Link>

        <h1 className="text-3xl font-display text-white mt-4">Privacy Policy</h1>
        <p className="text-white/40 text-sm mt-1">Last updated {UPDATED}</p>

        <p className="mt-6 text-white/65 text-[15px] leading-relaxed">
          ClubMode (<span className="text-white/85">club.coachmode.ai</span>) is software that
          racquet-sports clubs and league captains use to run teams, courts, programs and events.
          This policy covers the information the service holds and what is done with it.
        </p>

        <Section title="What we collect">
          <p>
            <strong className="text-white/85">Account information</strong> for staff and captains
            who sign in: name, email address, and the club they belong to.
          </p>
          <p>
            <strong className="text-white/85">Roster information</strong> that a club or captain
            enters about their own players: name, email address, mobile number, skill rating, and
            playing preferences such as which side they return on or days they cannot play.
          </p>
          <p>
            <strong className="text-white/85">Activity created in the product</strong>: availability
            answers, lineups, match results, court reservations, program registrations and event
            signups.
          </p>
          <p>
            We do not collect payment card numbers. Payments, where they occur, are handled by our
            payment processors and card details never reach our servers.
          </p>
        </Section>

        <Section title="How we use it">
          <p>
            To operate the service: build lineups, take attendance, schedule courts, and send the
            emails and text messages a captain or club sends to their own members — availability
            requests, lineup notices, confirmations and reminders.
          </p>
          <p>
            We do not use this information to build advertising profiles, and we do not sell it.
          </p>
        </Section>

        {/*
          The three clauses the A2P 10DLC campaign review checks for. Removing or
          softening any of them can get the campaign rejected, which takes SMS
          down for every club on the platform.
        */}
        <Section title="Text messages and your mobile number">
          <p className="text-white/85">
            Mobile numbers collected for text messaging are never shared with or sold to third
            parties or affiliates for their own marketing or promotional purposes. No mobile
            information is shared for any purpose other than delivering the messages you asked to
            receive.
          </p>
          <p>
            Players give their mobile number to their own club or team captain. It is used only to
            send that person messages about their own team and club activity — court assignments,
            lineup changes, confirmation requests, schedule changes and reminders.
          </p>
          <p>
            <strong className="text-white/85">Message frequency varies</strong>, and depends on your
            team&rsquo;s schedule. In an active season expect roughly one to four messages per
            match, and no messages at all outside the season.
          </p>
          <p>
            <strong className="text-white/85">Message and data rates may apply.</strong>
          </p>
          <p>
            Reply <strong className="text-white/85">STOP</strong> to any message to stop receiving
            them. Reply <strong className="text-white/85">HELP</strong> for help, or write to us at{' '}
            <a href={`mailto:${CONTACT}`} className="text-[#D3FB52] hover:underline">
              {CONTACT}
            </a>
            . Opting out of texts does not remove you from your team; your captain can still reach
            you by email.
          </p>
        </Section>

        <Section title="Who else sees it">
          <p>
            Information is visible to the staff of your own club and, for a team roster, to that
            team&rsquo;s captain and co-captains. Clubs cannot see one another&rsquo;s players.
          </p>
          <p>
            We use a small number of service providers to run the product, and they only ever
            receive what they need to perform their function: hosting and database
            (Vercel, Supabase), email delivery (Resend), text message delivery (Twilio), and payment
            processing. They are not permitted to use the information for their own purposes.
          </p>
          <p>We disclose information otherwise only when the law requires it.</p>
        </Section>

        <Section title="How long we keep it">
          <p>
            Club and roster information is kept while the club uses the service, because a season&rsquo;s
            records — who played, eligibility, results — only make sense over time. A club or
            captain can delete a player at any time, and we delete a club&rsquo;s data on request.
          </p>
        </Section>

        <Section title="Your choices">
          <p>
            Write to{' '}
            <a href={`mailto:${CONTACT}`} className="text-[#D3FB52] hover:underline">
              {CONTACT}
            </a>{' '}
            to see, correct, export or delete information we hold about you. Every email we send
            carries an unsubscribe link, and every text can be stopped by replying STOP.
          </p>
        </Section>

        <Section title="Children">
          <p>
            Junior programs are administered by a club through a parent or guardian, who provides
            the child&rsquo;s information and receives the messages. We do not knowingly collect
            information directly from children.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            If this policy changes materially we will update the date above and, where the change
            affects how we contact you, tell you directly.
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
          <Link href="/terms" className="text-white/50 hover:text-white underline">
            Terms of Service
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

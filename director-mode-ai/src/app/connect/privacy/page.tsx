import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Candidate privacy notice · ClubMode Recruiting',
  description: 'What ClubMode Recruiting collects from candidates, how AI is used, who sees what, and how to delete your profile.',
};

const UPDATED = 'October 22, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
      <div className="mt-2 space-y-2 text-slate-300">{children}</div>
    </section>
  );
}

// Plain-English privacy notice for candidates. Public.
export default function CandidatePrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-12">
      <Link href="/connect" className="text-sm text-teal-400 underline">ClubMode Recruiting</Link>
      <h1 className="mt-3 text-4xl font-bold tracking-tight text-white">Candidate privacy notice</h1>
      <p className="mt-2 text-sm text-slate-400">Last updated {UPDATED}</p>
      <p className="mt-4 text-lg text-slate-300">
        Short version: your profile is yours. A club sees it only after you say yes to that club. Your current pay is never
        shown to any club. You can delete everything yourself, any time.
      </p>

      <Section title="What we collect">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-white">Your profile:</strong> name, email, phone (optional), headline, role, years of experience, certifications, LinkedIn (optional), experience summary, home ZIP and how far you&apos;d move.</li>
          <li><strong className="text-white">Your résumé</strong>, if you upload one.</li>
          <li><strong className="text-white">Pay:</strong> your current total pay and the least you&apos;d take (your floor).</li>
          <li><strong className="text-white">Your preferences:</strong> whether you&apos;re open to work, how contact details are released, and the jobs you apply to or say you&apos;re interested in.</li>
          <li>Notes you write to a club when you apply.</li>
        </ul>
        <p>You enter all of this yourself. Nobody can create a candidate profile for you, and using other parts of ClubMode never signs you up.</p>
      </Section>

      <Section title="How we use AI">
        <p>We use AI for two things, both limited to job-related information:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-white">Matching:</strong> finding openings that fit your role, location and pay floor, so we can tell you about them.</li>
          <li><strong className="text-white">Fit notes:</strong> when you apply, a short read of how your stated experience, certifications and results line up with the club&apos;s requirements, with questions to ask in interview.</li>
        </ul>
        <p>
          The AI is told not to consider or mention age, gender, ethnicity, national origin, religion, health, disability or
          family status, and it never sees your name or contact details. It never states your pay. People make every hiring
          decision: clubs interview, choose and employ; the AI only helps sort and summarize.
        </p>
      </Section>

      <Section title="Who sees what">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-white">Clubs</strong> see your profile and résumé only after you consent to that specific club, for that specific role (by applying, or by checking &quot;OK to present my profile&quot;). Consent to one club is never consent to another.</li>
          <li>
            <strong className="text-white">Matches:</strong> when a club&apos;s opening matches you, it sees an anonymous summary
            (headline, years of experience, distance). Your name and contact details are released only under the reveal
            setting you pick on your profile: &quot;Approve first&quot; asks you club by club; &quot;Auto-reveal&quot; releases them to
            matching clubs automatically. Your résumé is never released by a match.
          </li>
          <li><strong className="text-white">Your current pay is never shown to clubs.</strong> We use it only to judge whether a job is a step up for you.</li>
          <li><strong className="text-white">Your current employer</strong> is never told you have a profile or that you applied anywhere.</li>
          <li><strong className="text-white">ClubMode Recruiting staff</strong> can see your profile to run matching and answer your questions.</li>
          <li>We don&apos;t sell your information or share it with advertisers.</li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <p>
          Your profile and résumé stay until you delete them. If you apply to a club, that club keeps what you sent it under
          its own policies. If a club hires you through us, we keep a minimal placement record (the club, the role, your
          name, the dates and the fee) for billing and our records, even after you delete your profile.
        </p>
      </Section>

      <Section title="Pausing, withdrawing and deleting">
        <ul className="list-disc space-y-1 pl-5">
          <li><strong className="text-white">Pause:</strong> turn off &quot;Open to work&quot; on your profile and we stop matching you.</li>
          <li><strong className="text-white">Withdraw:</strong> withdraw any application from your profile, or withdraw your interest on a job page.</li>
          <li>
            <strong className="text-white">Delete:</strong> use &quot;Delete my candidate profile and résumé&quot; at the bottom of{' '}
            <Link href="/connect/candidate" className="text-teal-400 underline">your candidate profile</Link>. It erases your
            profile details and every résumé file, and withdraws your open applications and interests straight away.
          </li>
        </ul>
      </Section>

      <Section title="Questions">
        <p>Reply to any email from ClubMode Recruiting and a person will answer.</p>
      </Section>

      <p className="mt-10 text-sm text-slate-400">
        <Link href="/connect/candidate" className="text-teal-400 underline">Your candidate profile</Link>
        <span className="mx-2">·</span>
        <Link href="/connect/jobs" className="text-teal-400 underline">Open jobs</Link>
      </p>
    </div>
  );
}

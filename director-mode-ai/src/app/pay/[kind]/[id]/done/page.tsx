/**
 * After paying (Square's redirect), or when there's nothing to pay. Reads the
 * record, so "Paid" here means our webhook has actually marked it — and says
 * "processing" honestly in the seconds before it has.
 */
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const TABLE = { program: 'club_program_registrations', court: 'court_bookings' } as const;

export default async function PayDone({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ s?: string }>;
}) {
  const { kind, id } = await params;
  const { s } = await searchParams;
  const table = TABLE[kind as keyof typeof TABLE];
  const { data } = table
    ? await getSupabaseAdmin().from(table).select('payment_status, cc_clubs(name)').eq('id', id).maybeSingle()
    : { data: null };
  const row = data as { payment_status: string; cc_clubs: { name: string } | null } | null;
  const club = row?.cc_clubs?.name ?? 'the club';

  const [title, body] =
    row?.payment_status === 'paid' || s === 'paid'
      ? ['Paid — thank you', `${club} has your payment. Nothing else to do.`]
      : s === 'cancelled'
        ? ['This was cancelled', `There's nothing to pay. Questions? Contact ${club}.`]
        : s === 'free'
          ? ['Nothing to pay', 'This one is free.']
          : s === 'notfound' || !row
            ? ['Link not recognised', 'Check the link in your email, or contact the club.']
            : s === 'unavailable'
              ? ['Card payment is unavailable right now', `Please try again shortly, or pay ${club} directly.`]
              : ['Payment processing', 'Square is confirming your payment — this page will say Paid within a minute. You can close it.'];

  return (
    <div style={{ colorScheme: 'light', background: '#f1f5f9', minHeight: '100vh' }}>
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '0 auto', padding: '64px 20px', color: '#0f172a' }}>
        <h1 style={{ fontSize: 26, margin: '0 0 10px' }}>{title}</h1>
        <p style={{ fontSize: 16, color: '#475569', lineHeight: 1.5 }}>{body}</p>
      </main>
    </div>
  );
}

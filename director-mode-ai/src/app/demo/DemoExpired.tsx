/**
 * What an expired, revoked or mistyped demo link shows. Deliberately says
 * nothing about why: a guessed token and a revoked one look the same.
 */
export default function DemoExpired({
  title = 'This demo link has expired.',
  body = 'Ask Darrin for a new one.',
  back,
}: {
  title?: string;
  body?: string;
  back?: { href: string; label: string };
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f1ea] px-4 py-16 text-[#1c2321]">
      <div className="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-lg sm:p-10">
        <h1 className="text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
        <p className="mt-4 text-xl leading-relaxed">{body}</p>
        {back && (
          <a
            href={back.href}
            className="mt-8 inline-flex min-h-[56px] items-center justify-center rounded-2xl bg-[#14532d] px-6 py-3 text-lg font-bold text-white"
          >
            {back.label}
          </a>
        )}
      </div>
    </div>
  );
}

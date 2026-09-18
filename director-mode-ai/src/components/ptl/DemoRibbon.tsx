/**
 * The bar across the top of a demo season.
 *
 * Says the quiet part out loud. Someone sent this link to be sold to, and they
 * are about to click an enrolment form and a live draft — so they need to know,
 * before they touch anything, that the players are invented and that nothing
 * they do here reaches a real person. Vague reassurance ("sample data") is what
 * makes people hesitate to click; naming the two specific fears removes them.
 */

export function DemoRibbon({ note }: { note?: string | null }) {
  return (
    <div className="border-b border-amber-300/25 bg-amber-300/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5 text-[13px]">
        <span className="font-bold uppercase tracking-[0.18em] text-amber-300">Demo</span>
        <span className="text-white/80">
          {note || 'A sample season — explore anything you like.'}
        </span>
        <span className="text-white/50">
          Every player here is invented, and nothing on these pages emails anyone.
        </span>
      </div>
    </div>
  );
}

export default DemoRibbon;

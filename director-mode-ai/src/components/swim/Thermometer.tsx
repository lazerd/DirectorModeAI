'use client';

/**
 * Animated water-fill thermometer.
 *
 *  - Gradient color fill rises from the bulb.
 *  - Animated SVG wave at the top of the fill so it looks like real water.
 *  - Pending (signed-up) layered above earned in a softer translucent gray.
 *  - Bulb glows when complete (>=100%).
 *
 * Color: red < 50%, amber 50-99%, emerald >=100%.
 */
export default function Thermometer({
  earned,
  pending,
  required,
  size = 'md',
  showLabel = true,
}: {
  earned: number;
  pending: number;
  required: number;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}) {
  const target = Math.max(1, required);
  const earnedPct = Math.min(100, Math.round((earned / target) * 100));
  const pendingPct = Math.min(100 - earnedPct, Math.round((pending / target) * 100));
  const totalPct = earnedPct + pendingPct;
  const complete = earnedPct >= 100;

  // Tier-based color palette
  const palette = complete
    ? {
        from: '#10b981', // emerald-500
        to: '#34d399', // emerald-400
        glow: 'shadow-[0_0_30px_rgba(16,185,129,0.55)]',
        wave: '#34d399',
        bulbBorder: 'border-emerald-600',
      }
    : earnedPct >= 50
      ? {
          from: '#f59e0b', // amber-500
          to: '#fbbf24', // amber-400
          glow: 'shadow-[0_0_18px_rgba(245,158,11,0.4)]',
          wave: '#fbbf24',
          bulbBorder: 'border-amber-600',
        }
      : {
          from: '#ef4444', // red-500
          to: '#f87171', // red-400
          glow: 'shadow-[0_0_14px_rgba(239,68,68,0.35)]',
          wave: '#f87171',
          bulbBorder: 'border-red-500',
        };

  const dims = {
    sm: { tubeW: 36, tubeH: 128, bulb: 48, label: 'text-xs', big: 'text-sm', pct: 'text-base' },
    md: { tubeW: 44, tubeH: 200, bulb: 64, label: 'text-sm', big: 'text-base', pct: 'text-2xl' },
    lg: { tubeW: 56, tubeH: 280, bulb: 84, label: 'text-base', big: 'text-lg', pct: 'text-4xl' },
  }[size];

  return (
    <div className="inline-flex flex-col items-center gap-2">
      {showLabel && (
        <div className="text-center">
          <div className={`font-extrabold text-gray-900 leading-none ${dims.pct}`}>
            {Math.round((earned / target) * 100)}
            <span className="text-gray-400 text-base font-bold">%</span>
          </div>
          {complete && (
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 mt-0.5">
              ★ Goal reached
            </div>
          )}
        </div>
      )}
      <div className="relative flex flex-col items-center">
        {/* Tube */}
        <div
          className="relative rounded-full border-2 border-gray-300 bg-white/90 overflow-hidden shadow-inner"
          style={{ width: dims.tubeW, height: dims.tubeH }}
        >
          {/* Tick lines (decorative, every 25%) */}
          {[25, 50, 75].map((tick) => (
            <div
              key={tick}
              className="absolute left-0 right-0 border-t border-gray-200/80 pointer-events-none"
              style={{ bottom: `${tick}%` }}
            />
          ))}

          {/* Pending (gray) overlay — sits ABOVE the earned fill */}
          {pendingPct > 0 && (
            <div
              className="absolute left-0 right-0 transition-all duration-700"
              style={{
                bottom: `${earnedPct}%`,
                height: `${pendingPct}%`,
                background:
                  'repeating-linear-gradient(45deg, rgba(156,163,175,0.55), rgba(156,163,175,0.55) 4px, rgba(209,213,219,0.55) 4px, rgba(209,213,219,0.55) 8px)',
              }}
              title={`${pending} pts pending (signed up)`}
            />
          )}

          {/* Earned fill */}
          <div
            className="absolute left-0 right-0 bottom-0 transition-all duration-700"
            style={{
              height: `${earnedPct}%`,
              background: `linear-gradient(to top, ${palette.from} 0%, ${palette.to} 100%)`,
            }}
            title={`${earned} pts earned`}
          >
            {/* Animated wave at the surface of the earned fill */}
            {earnedPct > 0 && earnedPct < 100 && (
              <svg
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                className="absolute -top-2 left-0 h-3"
                style={{ width: '200%', animation: 'thermo-wave 3s linear infinite' }}
                aria-hidden="true"
              >
                <path
                  d="M0,6 Q25,0 50,6 T100,6 T150,6 T200,6 V12 H0 Z"
                  fill={palette.wave}
                />
              </svg>
            )}
            {/* Subtle inner highlight (mercury shine) */}
            <div
              className="absolute top-0 bottom-0 w-1.5 rounded-full bg-white/30"
              style={{ left: 6 }}
            />
          </div>

          {/* Glass reflection highlight */}
          <div
            className="absolute top-0 bottom-0 w-1 rounded-full bg-white/40 pointer-events-none"
            style={{ left: 4 }}
          />
        </div>

        {/* Bulb */}
        <div
          className={`-mt-3 rounded-full border-2 ${palette.bulbBorder} flex items-center justify-center text-white font-extrabold relative ${complete ? palette.glow : ''}`}
          style={{
            width: dims.bulb,
            height: dims.bulb,
            background: `radial-gradient(circle at 30% 30%, ${palette.to} 0%, ${palette.from} 70%)`,
          }}
        >
          <span className={`relative z-10 ${dims.big}`}>{earned}</span>
          {/* Bulb shine */}
          <div
            className="absolute rounded-full bg-white/40 pointer-events-none"
            style={{ top: '15%', left: '20%', width: '25%', height: '20%' }}
          />
        </div>
      </div>
      {showLabel && (
        <div className={`text-center ${dims.label} text-gray-700`}>
          <div className="font-semibold">
            <span className="text-gray-900">{earned}</span>
            <span className="text-gray-400"> / </span>
            <span className="text-gray-900">{required}</span>
            <span className="text-gray-500 font-normal"> pts</span>
          </div>
          {pending > 0 && (
            <div className="text-xs text-gray-500 mt-0.5 inline-flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-gray-400/70" />
              +{pending} pending
            </div>
          )}
          {totalPct >= 100 && earnedPct < 100 && (
            <div className="text-xs text-amber-600 mt-0.5 font-medium">
              On track if all confirmed
            </div>
          )}
        </div>
      )}
      {/* Local keyframes — no global CSS file needed */}
      <style jsx>{`
        @keyframes thermo-wave {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
}

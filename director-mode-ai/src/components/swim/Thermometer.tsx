'use client';

/**
 * Vertical thermometer with two-stage fill.
 *
 *   completed (color: red < 50, amber 50-99, emerald >=100)
 *   pending   (gray, layered above completed)
 *
 * `required` is the family's target. Both bars are clamped at 100% visually.
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

  const earnedColor =
    earnedPct >= 100
      ? 'bg-emerald-500'
      : earnedPct >= 50
        ? 'bg-amber-400'
        : 'bg-red-400';
  const bulbColor =
    earnedPct >= 100 ? 'bg-emerald-500' : earnedPct >= 50 ? 'bg-amber-400' : 'bg-red-400';

  const dims = {
    sm: { tube: 'w-8 h-32', bulb: 'w-12 h-12', label: 'text-xs' },
    md: { tube: 'w-10 h-48', bulb: 'w-16 h-16', label: 'text-sm' },
    lg: { tube: 'w-14 h-72', bulb: 'w-20 h-20', label: 'text-base' },
  }[size];

  return (
    <div className="inline-flex flex-col items-center gap-1">
      {showLabel && (
        <div className={`font-bold text-gray-900 ${dims.label}`}>
          {Math.round((earned / target) * 100)}%
        </div>
      )}
      <div className="relative flex flex-col items-center">
        {/* Tube */}
        <div
          className={`relative ${dims.tube} rounded-full border-2 border-gray-300 bg-gray-100 overflow-hidden`}
        >
          {/* Pending (gray) overlay — anchored above earned */}
          {pendingPct > 0 && (
            <div
              className="absolute left-0 right-0 bg-gray-400/70 transition-all"
              style={{
                bottom: `${earnedPct}%`,
                height: `${pendingPct}%`,
              }}
              title={`${pending} pts pending (signed up)`}
            />
          )}
          {/* Earned fill — anchored to bottom */}
          <div
            className={`absolute left-0 right-0 bottom-0 ${earnedColor} transition-all`}
            style={{ height: `${earnedPct}%` }}
            title={`${earned} pts earned`}
          />
          {/* Tick marks at 50% */}
          <div className="absolute left-0 right-0 top-1/2 border-t border-white/60" />
        </div>
        {/* Bulb */}
        <div
          className={`-mt-3 ${dims.bulb} rounded-full border-2 border-gray-300 ${bulbColor} flex items-center justify-center text-white font-bold shadow-inner`}
        >
          <span className={dims.label}>{earned}</span>
        </div>
      </div>
      {showLabel && (
        <div className={`text-center ${dims.label} text-gray-700`}>
          <div className="font-semibold">
            {earned} <span className="text-gray-400">/</span>{' '}
            <span className="text-gray-900">{required}</span>
            <span className="text-gray-500"> pts</span>
          </div>
          {pending > 0 && (
            <div className="text-xs text-gray-500 mt-0.5">+{pending} pending</div>
          )}
          {totalPct >= 100 && earnedPct < 100 && (
            <div className="text-xs text-amber-600 mt-0.5 font-medium">
              On track if all confirmed
            </div>
          )}
        </div>
      )}
    </div>
  );
}

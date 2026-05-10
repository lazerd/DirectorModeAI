/**
 * Composite rating blender for league entries.
 *
 * Three inputs — NTRP (self-reported), UTR (auto-fetched), WTN (self-reported) —
 * get converted to a common UTR-equivalent scale and weighted-blended based
 * on what's available. Precise sources (UTR, WTN) get more weight than
 * coarse ones (NTRP). See the design discussion in chat for the rationale.
 */

export type RatingInputs = {
  ntrp: number | null;       // 2.5 - 5.5+
  utr: number | null;        // 1.0 - 16.5, null or 0 = unrated
  wtn: number | null;        // 1 - 40 (lower is better)
};

export type RatingResult = {
  composite: number;
  source: string;            // 'utr+wtn+ntrp', 'utr', 'ntrp', etc
  confidence: 'high' | 'medium' | 'low';
  flagDiscrepancy: boolean;  // true if sources disagree by > threshold
};

// UTR's published NTRP-to-UTR conversion (rough midpoints)
const NTRP_TO_UTR: Record<string, number> = {
  '2.5': 2.0,
  '3.0': 3.0,
  '3.5': 4.25,
  '4.0': 6.0,
  '4.5': 8.0,
  '5.0': 10.0,
  '5.5': 12.0,
  '6.0': 14.0,
};

/** Convert NTRP to UTR-equivalent. Returns null if NTRP not set. */
export function ntrpToUtrEq(ntrp: number | null): number | null {
  if (ntrp == null) return null;
  const key = ntrp.toFixed(1);
  if (NTRP_TO_UTR[key] != null) return NTRP_TO_UTR[key];
  // Fallback: linear interp for unusual values (e.g. 4.25 → ~7)
  if (ntrp >= 6.0) return 14.0;
  if (ntrp <= 2.5) return 2.0;
  // Piecewise-linear fallback between known points
  const steps = Object.keys(NTRP_TO_UTR).map(parseFloat).sort((a, b) => a - b);
  for (let i = 0; i < steps.length - 1; i++) {
    if (ntrp >= steps[i] && ntrp <= steps[i + 1]) {
      const t = (ntrp - steps[i]) / (steps[i + 1] - steps[i]);
      return NTRP_TO_UTR[steps[i].toFixed(1)] +
        t * (NTRP_TO_UTR[steps[i + 1].toFixed(1)] - NTRP_TO_UTR[steps[i].toFixed(1)]);
    }
  }
  return null;
}

/**
 * Convert WTN to UTR-equivalent. WTN is inverted (lower=better) and runs
 * 1-40, UTR is 1-16.5 (higher=better). Linear mapping:
 *   WTN 1  → UTR 16.6
 *   WTN 40 → UTR 1.0
 */
export function wtnToUtrEq(wtn: number | null): number | null {
  if (wtn == null) return null;
  if (wtn < 1 || wtn > 40) return null;
  return Math.max(1, 17 - wtn * 0.4);
}

/**
 * Treat UTR values of 0 as null — UTR uses 0.0 to mean "account exists
 * but not enough match history to calculate a rating." For seeding we
 * want to fall back to other sources, not seed everyone at 0.
 */
function normalizeUtr(utr: number | null): number | null {
  if (utr == null || utr === 0) return null;
  return utr;
}

/**
 * Given three rating inputs, compute a single composite UTR-equivalent
 * score plus metadata about how it was derived.
 */
export function computeCompositeRating(inputs: RatingInputs): RatingResult {
  const utr = normalizeUtr(inputs.utr);
  const wtnEq = wtnToUtrEq(inputs.wtn);
  const ntrpEq = ntrpToUtrEq(inputs.ntrp);

  const haveUtr = utr != null;
  const haveWtn = wtnEq != null;
  const haveNtrp = ntrpEq != null;

  // Count sources for discrepancy detection.
  const values: number[] = [];
  if (haveUtr) values.push(utr!);
  if (haveWtn) values.push(wtnEq!);
  if (haveNtrp) values.push(ntrpEq!);
  const maxDiff = values.length >= 2
    ? Math.max(...values) - Math.min(...values)
    : 0;
  const flagDiscrepancy = maxDiff > 1.5;

  // All three present
  if (haveUtr && haveWtn && haveNtrp) {
    return {
      composite: round2(0.5 * utr! + 0.3 * wtnEq! + 0.2 * ntrpEq!),
      source: 'utr+wtn+ntrp',
      confidence: 'high',
      flagDiscrepancy,
    };
  }
  // UTR + WTN (both precise)
  if (haveUtr && haveWtn) {
    return {
      composite: round2(0.6 * utr! + 0.4 * wtnEq!),
      source: 'utr+wtn',
      confidence: 'high',
      flagDiscrepancy,
    };
  }
  // UTR + NTRP (UTR wins heavily)
  if (haveUtr && haveNtrp) {
    return {
      composite: round2(0.75 * utr! + 0.25 * ntrpEq!),
      source: 'utr+ntrp',
      confidence: 'high',
      flagDiscrepancy,
    };
  }
  // WTN + NTRP
  if (haveWtn && haveNtrp) {
    return {
      composite: round2(0.7 * wtnEq! + 0.3 * ntrpEq!),
      source: 'wtn+ntrp',
      confidence: 'medium',
      flagDiscrepancy,
    };
  }
  // UTR only
  if (haveUtr) {
    return {
      composite: round2(utr!),
      source: 'utr',
      confidence: 'high',
      flagDiscrepancy: false,
    };
  }
  // WTN only
  if (haveWtn) {
    return {
      composite: round2(wtnEq!),
      source: 'wtn',
      confidence: 'medium',
      flagDiscrepancy: false,
    };
  }
  // NTRP only (the common rec-league case)
  if (haveNtrp) {
    return {
      composite: round2(ntrpEq!),
      source: 'ntrp',
      confidence: 'low',
      flagDiscrepancy: false,
    };
  }
  // Nothing — seed at 0 and let the director manually rank
  return {
    composite: 0,
    source: 'none',
    confidence: 'low',
    flagDiscrepancy: false,
  };
}

/**
 * Doubles team composite = average of the two players' composites.
 */
export function computeDoublesComposite(
  a: RatingInputs,
  b: RatingInputs
): RatingResult {
  const ra = computeCompositeRating(a);
  const rb = computeCompositeRating(b);
  const composite = round2((ra.composite + rb.composite) / 2);

  const rank: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };
  const lowerConfidence = rank[ra.confidence] <= rank[rb.confidence] ? ra.confidence : rb.confidence;

  return {
    composite,
    source: `doubles_avg(${ra.source}|${rb.source})`,
    confidence: lowerConfidence,
    flagDiscrepancy: ra.flagDiscrepancy || rb.flagDiscrepancy,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

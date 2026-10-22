import { describe, it, expect } from 'vitest';
import { addUsage, billedMicro, costMicro, emptyUsage, noticeStep, overCap, snapshot } from './meter';

const M = 1_000_000;

describe('Ask Claude meter', () => {
  it('prices Sonnet tokens at $3 in / $15 out, cache reads at a tenth', () => {
    const u = { input_tokens: 1000, output_tokens: 500, cache_read_tokens: 10_000, cache_write_tokens: 0 };
    // 1000*3 + 500*15 + 10000*0.3 = 3000 + 7500 + 3000 micro-dollars = 1.35 cents
    expect(costMicro('claude-sonnet-4-6', u)).toBe(13_500);
  });

  it('never prices an unknown model as free', () => {
    expect(costMicro('some-new-model', { ...emptyUsage(), input_tokens: 1000 })).toBeGreaterThan(0);
  });

  it('sums usage across rounds, including cache fields from the API names', () => {
    let u = emptyUsage();
    u = addUsage(u, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 50 });
    u = addUsage(u, { input_tokens: 1, output_tokens: 1 });
    expect(u).toEqual({ input_tokens: 11, output_tokens: 6, cache_read_tokens: 100, cache_write_tokens: 50 });
  });

  it('marks up cost by AI_MARKUP', () => {
    expect(billedMicro(10_000)).toBe(15_000);
  });

  it('bills everything: nothing is included', () => {
    expect(snapshot(3 * M, false).overageUsd).toBeCloseTo(3);
    expect(snapshot(7.5 * M, false).overageUsd).toBeCloseTo(7.5);
  });

  it('steps a notice at every $10 spent', () => {
    expect(noticeStep(9.99 * M)).toBe(0);
    expect(noticeStep(10 * M)).toBe(1);
    expect(noticeStep(25.01 * M)).toBe(2);
  });

  it('without a card, stops before the first request', () => {
    expect(overCap(0, false)).toBe(true);
    expect(snapshot(0, false).needsPayg).toBe(true);
  });

  it('with pay-as-you-go, runs to the monthly cap', () => {
    expect(overCap(50 * M, false, true)).toBe(false);
    expect(overCap(100 * M, false, true)).toBe(true);
    expect(snapshot(50 * M, false, undefined, true).needsPayg).toBe(false);
  });

  it('never pauses exempt accounts', () => {
    expect(overCap(500 * M, true)).toBe(false);
    expect(snapshot(500 * M, true).needsPayg).toBe(false);
  });
});

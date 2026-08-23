import { describe, it, expect } from 'vitest';
import { reportToDeskText } from './speech';

describe('reportToDeskText', () => {
  it('reads exactly as Darrin dictated it', () => {
    expect(reportToDeskText('Amber Smith', 'Sue Johnson'))
      .toBe('Amber Smith and Sue Johnson, please report to the tournament desk.');
  });

  it('leaves out a side that has not been decided yet', () => {
    // Half the consolation draw sits as "TBD" until the feed-ins land, and
    // announcing "TBD, please report" would be nonsense over a PA.
    expect(reportToDeskText('Levin Anderson', 'TBD'))
      .toBe('Levin Anderson, please report to the tournament desk.');
    expect(reportToDeskText('TBD', 'Finn Lai'))
      .toBe('Finn Lai, please report to the tournament desk.');
  });

  it('still says something useful when neither side is known', () => {
    expect(reportToDeskText('TBD', 'TBD'))
      .toBe('Players, please report to the tournament desk.');
  });

  it('tolerates stray whitespace from the feed', () => {
    expect(reportToDeskText('  Amber Smith ', ' Sue Johnson'))
      .toBe('Amber Smith and Sue Johnson, please report to the tournament desk.');
  });
});

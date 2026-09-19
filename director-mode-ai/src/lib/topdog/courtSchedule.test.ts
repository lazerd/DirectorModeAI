import { describe, expect, it } from 'vitest';
import { parseCourtSchedule, parseMatchLine, parseTimeToMinutes } from './courtSchedule';

const PAGE = `<html><head><title>#2 RSPA/USPTA Jr Circuit Sleepy Hollow T&amp;S Match Schedule | TopDog Sports</title></head><body>
<select name="currentdate" onchange="setdatachanged(this)">
<option value="9/18/2026" >Friday, September 18, 2026</option>
<option value="9/19/2026"  selected >Saturday, September 19, 2026</option>
</select>
<table class="table table-striped">
<tr><td style="x" width="20px"></td><td style="x" width="20px">Unknown Court</td></tr>
<tr><td width="20px">8:00am</td><td class="matches">Boys' 10 Singles Round 16 Bennett J Stocker vs. Niam R Pathare<br>Boys' 10 Singles Round 16 <b>Massimo Cardenas</b> vs. Rory Frase (default)&nbsp;</td></tr>
<tr><td width="20px">1:30pm</td><td class="matches">Boys' 10 Singles Consol Quarters Rory Frase vs. <br>Girls' 12 Singles Semis  vs. <br>Boys' 12 Singles Quarters Declan H Gonzales vs. <b>James J McGinley</b> (6-2,6-2)&nbsp;</td></tr>
</table></body></html>`;

describe('parseCourtSchedule', () => {
  const s = parseCourtSchedule(PAGE);

  it('reads the name and the selected day', () => {
    expect(s.name).toBe('#2 RSPA/USPTA Jr Circuit Sleepy Hollow T&S');
    expect(s.dates.map((d) => d.value)).toEqual(['9/18/2026', '9/19/2026']);
    expect(s.date).toBe('9/19/2026');
  });

  it('reads every match with its time and no court', () => {
    expect(s.matches).toHaveLength(5);
    expect(s.matches[0]).toMatchObject({
      time: '8:00am', court: null, event: "Boys' 10 Singles", round: 'Round 16',
      playerA: 'Bennett J Stocker', playerB: 'Niam R Pathare', winner: null, result: null,
    });
  });

  it('knows a played match and who won it', () => {
    expect(s.matches[1]).toMatchObject({ playerA: 'Massimo Cardenas', playerB: 'Rory Frase', winner: 'A', result: 'default' });
    expect(s.matches[4]).toMatchObject({ winner: 'B', result: '6-2,6-2', round: 'Quarters' });
  });

  it('leaves a side blank while it waits on an earlier result', () => {
    expect(s.matches[2]).toMatchObject({ round: 'Consol Quarters', playerA: 'Rory Frase', playerB: '' });
    expect(s.matches[3]).toMatchObject({ round: 'Semis', playerA: '', playerB: '' });
  });
});

describe('parseMatchLine', () => {
  it('copes with a blank round', () => {
    expect(parseMatchLine("Boys' 16 Singles  Miles Hall vs. <b>Hunter T Fasteau</b> (default)")).toMatchObject({
      event: "Boys' 16 Singles", round: '', playerA: 'Miles Hall', playerB: 'Hunter T Fasteau', winner: 'B',
    });
  });
});

describe('parseTimeToMinutes', () => {
  it('handles noon and the afternoon', () => {
    expect(parseTimeToMinutes('8:00am')).toBe(480);
    expect(parseTimeToMinutes('12:30pm')).toBe(750);
    expect(parseTimeToMinutes('1:30pm')).toBe(810);
  });
});

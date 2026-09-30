import {describe, expect, it} from 'vitest';
import {
  normalizeFuturesBars,
  normalizeIndexBars,
  normalizeSnapshot,
  marketDate,
  parseEiaWti,
  parseWcsWeekly,
  selectFrontMonth,
} from './energy-ticker';

describe('market ticker price semantics', () => {
  it('compares the two latest index closes rather than the opening price', () => {
    const q = normalizeIndexBars('NASDAQ', [{c:100,t:1000},{c:105,t:3000},{c:110,t:2000}]);
    expect(q.price).toBe(105);
    expect(q.change).toBe(-5);
    expect(q.percent).toBeCloseTo(-4.54545);
  });
  it('rejects index data without a previous close', () => {
    expect(() => normalizeIndexBars('DOW', [{c:100,t:1000}])).toThrow();
  });
  it('uses the latest minute stock price and previous close', () => {
    const q = normalizeSnapshot({ticker:'XOM',min:{c:99,t:1000},day:{c:98},prevDay:{c:100}});
    expect(q).toMatchObject({price:99,change:-1,percent:-1});
  });
  it('preserves source dates over missing days and month boundaries for Brent', () => {
    const q = parseEiaWti('<tr><td>2026 Aug-31 to Sep-04</td><td>70</td><td></td><td>72</td><td></td><td></td></tr>','BRENT');
    expect(q).toMatchObject({symbol:'BRENT',price:72,change:2,asOf:'2026-09-02'});
    expect(q.percent).toBeCloseTo(2/70*100);
  });
  it('accepts genuine negative oil prices and rejects non-data pages', () => {
    expect(parseEiaWti('<tr><td>2020 Apr-20 to Apr-24</td><td>-37</td><td>10</td><td></td><td></td><td></td></tr>').change).toBe(47);
    expect(() => parseEiaWti('<html>temporarily unavailable</html>')).toThrow();
  });
  it('reads the current WCS weekly price and its reported change', () => {
    const html = `<tr><td style='font-weight:bold'>WCS</td><td>71.66</td><td width='60px'><font color='red'>-7.64</font><td width='60px'><font color='red'>&#9660;-9.6%</font></td><td>-20.75</td></tr>`;
    expect(parseWcsWeekly(html)).toMatchObject({
      symbol: 'WCS',
      price: 71.66,
      change: -7.64,
      percent: -9.6,
    });
  });
  it('rejects a Heavy Crude page that does not contain a WCS price row', () => {
    expect(() => parseWcsWeekly('<html>temporarily unavailable</html>')).toThrow();
  });
  it('chooses the nearest unexpired single Dow futures contract', () => {
    const contracts = [
      {ticker:'YM:BF Z6-H7',type:'combo',days_to_maturity:5},
      {ticker:'YMH7',type:'single',days_to_maturity:171},
      {ticker:'YMZ6',type:'single',days_to_maturity:80},
    ];
    expect(selectFrontMonth(contracts)).toBe('YMZ6');
  });
  it('uses the Chicago market date after UTC has crossed midnight', () => {
    expect(marketDate(new Date('2026-09-30T01:00:00.000Z'))).toBe('2026-09-29');
  });
  it('calculates the Dow futures move from the latest two completed sessions', () => {
    const q = normalizeFuturesBars('DOW', [
      {close:51821,window_start:3000,session_end_date:'2026-09-30'},
      {close:51755,settlement_price:51702,window_start:2000,session_end_date:'2026-09-29'},
      {close:51846,settlement_price:51837,window_start:1000,session_end_date:'2026-09-28'},
    ]);
    expect(q).toMatchObject({symbol:'DOW',price:51702,change:-135,asOf:'2026-09-29'});
    expect(q.percent).toBeCloseTo(-135/51837*100);
  });
});

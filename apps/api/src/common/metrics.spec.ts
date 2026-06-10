import { describe, expect, it } from 'vitest';
import { aqiFromPm, backoffMs, shouldAbort } from './metrics';

describe('shouldAbort — reference refresh data-integrity guardrail', () => {
  it('refuses (true) when more than 5% of countries failed', () => {
    expect(shouldAbort(11, 200)).toBe(true); // 11 > 10
  });

  it('proceeds (false) exactly at the 5% threshold — strictly greater-than', () => {
    expect(shouldAbort(10, 200)).toBe(false); // 10 is not > 10
  });

  it('proceeds when nothing failed and aborts when everything failed', () => {
    expect(shouldAbort(0, 200)).toBe(false);
    expect(shouldAbort(200, 200)).toBe(true);
  });

  it('honours a custom max fraction', () => {
    expect(shouldAbort(1, 10, 0.1)).toBe(false); // 1 is not > 1
    expect(shouldAbort(2, 10, 0.1)).toBe(true); //  2 > 1
  });
});

describe('backoffMs — exponential retry delay', () => {
  it('doubles each attempt from the base', () => {
    expect(backoffMs(0)).toBe(300);
    expect(backoffMs(1)).toBe(600);
    expect(backoffMs(2)).toBe(1200);
    expect(backoffMs(3)).toBe(2400);
  });

  it('honours a custom base', () => {
    expect(backoffMs(2, 100)).toBe(400);
  });

  it('is strictly increasing', () => {
    const ds = [0, 1, 2, 3, 4].map((a) => backoffMs(a));
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThan(ds[i - 1]);
  });
});

describe('aqiFromPm — US EPA breakpoint mapping', () => {
  it('maps band boundaries exactly', () => {
    expect(aqiFromPm(0)).toBe(0);
    expect(aqiFromPm(12)).toBe(50); // top of Good
    expect(aqiFromPm(12.1)).toBe(51); // bottom of Moderate
    expect(aqiFromPm(35.4)).toBe(100);
    expect(aqiFromPm(35.5)).toBe(101);
    expect(aqiFromPm(55.4)).toBe(150);
  });

  it('clamps to 500 at and above the top of the scale', () => {
    expect(aqiFromPm(500)).toBe(500);
    expect(aqiFromPm(900)).toBe(500);
  });
});

import { describe, expect, it } from 'vitest';
import { gapRatio, monitorsNeeded } from './gap';

describe('gapRatio — deaths per 100k ÷ monitors per 100k', () => {
  it('is null when a country has no monitors', () => {
    expect(gapRatio(50, 1_000_000, 0)).toBeNull();
  });

  it('computes the basic ratio (1 monitor per 100k → gap == death rate)', () => {
    expect(gapRatio(50, 1_000_000, 10)).toBe(50); // monitors_per_100k = 1
  });

  it('clamps the divisor at 0.001 so one monitor in a huge population cannot explode the gap', () => {
    expect(gapRatio(50, 1_000_000_000, 1)).toBe(50_000); // 50 / 0.001
  });

  it('grows with burden and shrinks with coverage', () => {
    expect(gapRatio(100, 1_000_000, 10)).toBeGreaterThan(gapRatio(50, 1_000_000, 10)!);
    expect(gapRatio(50, 1_000_000, 5)!).toBeGreaterThan(gapRatio(50, 1_000_000, 50)!);
  });
});

describe('monitorsNeeded — monitors to add to reach the Lv-1 threshold', () => {
  it('returns the shortfall when a country is under-monitored', () => {
    expect(monitorsNeeded(50, 10_000_000, 20, 5)).toBe(980);
  });

  it('returns 0 when the country is already in the good zone', () => {
    expect(monitorsNeeded(10, 1_000_000, 50, 5)).toBe(0);
  });

  it('never goes negative', () => {
    expect(monitorsNeeded(1, 1_000_000, 1000, 5)).toBe(0);
  });

  it('rounds the requirement up (a partial monitor still counts as one)', () => {
    expect(monitorsNeeded(5, 150_000, 0, 5)).toBe(2); // raw need 1.5 → 2
  });
});

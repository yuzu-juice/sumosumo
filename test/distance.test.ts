import { describe, it, expect } from 'vitest';
import { haversineM, formatDistance } from '../src/lib/distance';

describe('haversineM', () => {
  it('同一点は0m', () => {
    expect(haversineM(35.6812, 139.7671, 35.6812, 139.7671)).toBe(0);
  });

  it('新宿駅〜渋谷駅は約3km', () => {
    const d = haversineM(35.6909, 139.7003, 35.658, 139.7016);
    expect(d).toBeGreaterThan(2500);
    expect(d).toBeLessThan(4500);
  });

  it('対称性がある', () => {
    const a = haversineM(35.0, 139.0, 36.0, 140.0);
    const b = haversineM(36.0, 140.0, 35.0, 139.0);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('formatDistance', () => {
  it('km以下はm表記', () => {
    expect(formatDistance(350)).toBe('350m');
    expect(formatDistance(999)).toBe('999m');
  });
  it('1km以上はkm表記', () => {
    expect(formatDistance(1000)).toBe('1.0km');
    expect(formatDistance(3450)).toBe('3.5km');
  });
});

import { describe, it, expect } from 'vitest';
import { findLongestTown, reverseGeocode } from '../src/lib/geocode';

describe('findLongestTown', () => {
  it('丁目付き住所', () => {
    expect(findLongestTown('西新宿4丁目12-3')).toBe('西新宿4丁目');
  });

  it('番地のみ（1-1形式）', () => {
    expect(findLongestTown('西新宿1-1')).toBe('西新宿1丁目');
  });

  it('番地のみ（数字のみ）', () => {
    expect(findLongestTown('新宿3')).toBe('新宿3丁目');
  });

  it('丁目なし町名', () => {
    expect(findLongestTown('歌舞伎町1-4-1')).toBe('歌舞伎町');
    expect(findLongestTown('北町')).toBe('北町');
  });

  it('無関係な文字列はnull', () => {
    expect(findLongestTown('どこでもない')).toBeNull();
  });
});

describe('reverseGeocode', () => {
  const mockDb = {
    prepare: () => ({
      all: async () => ({
        results: [
          { town: '西新宿1丁目', lat: 35.6904, lon: 139.6977 },
          { town: '歌舞伎町', lat: 35.6944, lon: 139.7009 },
          { town: '新宿', lat: 35.6939, lon: 139.7034 },
        ],
      }),
    }),
  } as unknown as D1Database;

  it('最寄りの町丁目を返す', async () => {
    // 西新宿1丁目 (35.6904, 139.6977) に近い地点
    const addr = await reverseGeocode(mockDb, 35.6905, 139.698);
    expect(addr).toBe('東京都新宿区西新宿1丁目');
  });

  it('2km以上離れていれば区レベルにフォールバック', async () => {
    const addr = await reverseGeocode(mockDb, 35.6, 139.6);
    expect(addr).toBe('東京都新宿区');
  });
});


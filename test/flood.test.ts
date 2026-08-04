import { describe, it, expect } from 'vitest';

// main.tsのmarchingSquaresをスタンドアロンで再実装して検証する
function marchingSquaresTest(
  grid: Map<string, number>,
  lats: number[],
  lons: number[],
  dLat: number,
  dLon: number,
  threshold: number,
): Array<Array<[number, number]>> {
  const above = (lat: number, lon: number): boolean => {
    const v = grid.get(`${lat},${lon}`);
    return v !== undefined && v >= threshold;
  };
  const halfLat = dLat * 0.5;
  const halfLon = dLon * 0.5;
  const cells = lats.flatMap((lat) =>
    lons.filter((lon) => above(lat, lon)).map((lon) => ({ lat, lon })),
  );
  if (!cells.length) return [];
  const edges: Map<string, Array<[number, number]>> = new Map();
  const corners = (c: { lat: number; lon: number }): Array<[number, number]> => [
    [c.lat - halfLat, c.lon - halfLon],
    [c.lat - halfLat, c.lon + halfLon],
    [c.lat + halfLat, c.lon + halfLon],
    [c.lat + halfLat, c.lon - halfLon],
  ];
  for (const c of cells) {
    const pts = corners(c);
    if (!above(c.lat + dLat, c.lon)) edges.set(`n${c.lat},${c.lon}`, [pts[2], pts[3]]);
    if (!above(c.lat, c.lon + dLon)) edges.set(`e${c.lat},${c.lon}`, [pts[1], pts[2]]);
    if (!above(c.lat - dLat, c.lon)) edges.set(`s${c.lat},${c.lon}`, [pts[0], pts[1]]);
    if (!above(c.lat, c.lon - dLon)) edges.set(`w${c.lat},${c.lon}`, [pts[3], pts[0]]);
  }
  const rings: Array<Array<[number, number]>> = [];
  const unused = new Set(edges.keys());
  while (unused.size) {
    const startKey = unused.values().next().value as string;
    unused.delete(startKey);
    const ring: Array<[number, number]> = [];
    let cur = edges.get(startKey)!;
    ring.push(cur[0], cur[1]);
    let guard = 0;
    const guardMax = edges.size * 2;
    while (unused.size && guard < guardMax) {
      guard++;
      const tail = cur[1];
      let found = false;
      for (const key of unused) {
        const e = edges.get(key)!;
        if (e[0][0] === tail[0] && e[0][1] === tail[1]) {
          ring.push(e[1]);
          cur = e;
          unused.delete(key);
          found = true;
          break;
        } else if (e[1][0] === tail[0] && e[1][1] === tail[1]) {
          ring.push(e[0]);
          cur = [e[1], e[0]];
          unused.delete(key);
          found = true;
          break;
        }
      }
      if (!found) break;
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

describe('marchingSquares', () => {
  it('単一セルが閾値以上なら1つの閉じた輪郭を生成する', () => {
    const grid = new Map<string, number>();
    grid.set('0,0', 0); grid.set('0,1', 0); grid.set('0,2', 0);
    grid.set('1,0', 0); grid.set('1,1', 3); grid.set('1,2', 0);
    grid.set('2,0', 0); grid.set('2,1', 0); grid.set('2,2', 0);
    const rings = marchingSquaresTest(grid, [0, 1, 2], [0, 1, 2], 1, 1, 1.0);
    expect(rings.length).toBeGreaterThan(0);
    expect(rings[0].length).toBeGreaterThanOrEqual(4);
  });

  it('閾値未満のみなら輪郭なし', () => {
    const grid = new Map<string, number>();
    grid.set('0,0', 0); grid.set('0,1', 0);
    grid.set('1,0', 0); grid.set('1,1', 0.5);
    const rings = marchingSquaresTest(grid, [0, 1], [0, 1], 1, 1, 1.0);
    expect(rings.length).toBe(0);
  });

  it('2x2の閾値以上領域は1つの輪郭になる（共有エッジが除去される）', () => {
    const grid = new Map<string, number>();
    grid.set('0,0', 2); grid.set('0,1', 2);
    grid.set('1,0', 2); grid.set('1,1', 2);
    const rings = marchingSquaresTest(grid, [0, 1], [0, 1], 1, 1, 1.0);
    expect(rings.length).toBe(1);
    // 2x2セルの外周 = 8エッジ → 8〜9頂点の閉じたリング
    expect(rings[0].length).toBeGreaterThanOrEqual(8);
  });

  it('分離した2領域は2つの輪郭になる', () => {
    const grid = new Map<string, number>();
    grid.set('0,0', 2); grid.set('0,2', 2);
    const rings = marchingSquaresTest(grid, [0, 1], [0, 1, 2], 1, 1, 1.0);
    expect(rings.length).toBe(2);
  });
});

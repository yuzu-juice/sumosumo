import { describe, it, expect } from 'vitest';
import { Router, haversine, MinHeap } from '../src/client/router';

// 単純な線路グラフ: 0-1-2-3
function lineGraph() {
  const nodes = [
    [0, 35.0, 139.0],
    [1, 35.001, 139.0],
    [2, 35.002, 139.0],
    [3, 35.003, 139.0],
  ] as Array<[number, number, number]>;
  const d = haversine(35.0, 139.0, 35.001, 139.0);
  const edges = [
    [0, 1, d],
    [1, 2, d],
    [2, 3, d],
  ] as Array<[number, number, number]>;
  return { nodes, edges };
}

describe('haversine', () => {
  it('同一点は0', () => {
    expect(haversine(35.0, 139.0, 35.0, 139.0)).toBe(0);
  });
  it('1緯度約111km', () => {
    expect(haversine(35.0, 139.0, 36.0, 139.0)).toBeGreaterThan(110000);
    expect(haversine(35.0, 139.0, 36.0, 139.0)).toBeLessThan(112000);
  });
});

describe('Router', () => {
  it('単純線路の最短経路を見つける', () => {
    const r = new Router(lineGraph());
    const route = r.route(35.0, 139.0, 35.003, 139.0);
    expect(route).not.toBeNull();
    expect(route!.distanceM).toBeCloseTo(3 * haversine(35.0, 139.0, 35.001, 139.0), 0);
    expect(route!.path.length).toBeGreaterThanOrEqual(4);
    expect(route!.elevGainM).toBeGreaterThanOrEqual(0);
  });

  it('孤立成分のノードを避けてメイン成分を使う', () => {
    // メイン成分: 0-1  / 孤立ノード: 2
    const g = {
      nodes: [
        [0, 35.0, 139.0],
        [1, 35.001, 139.0],
        [2, 35.0005, 139.0005], // 孤立
      ] as Array<[number, number, number]>,
      edges: [[0, 1, haversine(35.0, 139.0, 35.001, 139.0)]] as Array<[number, number, number]>,
    };
    const r = new Router(g);
    // 孤立ノード(2)の近くからメイン成分(0)への経路
    const route = r.route(35.0005, 139.0005, 35.0, 139.0);
    expect(route).not.toBeNull();
  });
});

export interface RoadGraph {
  nodes: Array<[number, number, number, number?]>; // [id, lat, lon, elev?]
  edges: Array<[number, number, number]>; // [fromId, toId, distM]
}

export interface RouteResult {
  path: Array<[number, number]>; // [lat, lon] の軌跡
  distanceM: number;
}

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 二分ヒープによる優先度キュー
export class MinHeap {
  private heap: Array<{ id: number; f: number }> = [];
  push(item: { id: number; f: number }) {
    this.heap.push(item);
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[p].f <= this.heap[i].f) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }
  pop(): { id: number; f: number } | undefined {
    if (!this.heap.length) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length) {
      this.heap[0] = last;
      let i = 0;
      const n = this.heap.length;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let m = i;
        if (l < n && this.heap[l].f < this.heap[m].f) m = l;
        if (r < n && this.heap[r].f < this.heap[m].f) m = r;
        if (m === i) break;
        [this.heap[m], this.heap[i]] = [this.heap[i], this.heap[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.heap.length;
  }
}

export class Router {
  private graph: RoadGraph;
  private adjacency: Array<Array<[number, number]>>;

  constructor(graph: RoadGraph) {
    this.graph = graph;
    // ノードid == 配列インデックス が前提（buildGraphで連番を保証）
    this.adjacency = graph.nodes.map(() => []);
    graph.edges.forEach(([a, b, d]) => {
      this.adjacency[a].push([b, d]);
      this.adjacency[b].push([a, d]);
    });
  }

  nearestNode(lat: number, lon: number): number {
    return this.nearestNodeInMainComponent(lat, lon);
  }

  // A*: 最短経路を返す
  route(fromLat: number, fromLon: number, toLat: number, toLon: number): RouteResult | null {
    const start = this.nearestNodeInMainComponent(fromLat, fromLon);
    const goal = this.nearestNodeInMainComponent(toLat, toLon);
    if (start < 0 || goal < 0 || start === goal) return null;

    const n = this.graph.nodes.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();

    gScore[start] = 0;
    heap.push({ id: start, f: haversine(fromLat, fromLon, this.graph.nodes[start][1], this.graph.nodes[start][2]) });

    while (heap.size > 0) {
      const cur = heap.pop()!;
      if (closed[cur.id]) continue;
      closed[cur.id] = 1;
      if (cur.id === goal) break;
      for (const [nextId, dist] of this.adjacency[cur.id]) {
        if (closed[nextId]) continue;
        const tentative = gScore[cur.id] + dist;
        if (tentative < gScore[nextId]) {
          gScore[nextId] = tentative;
          prev[nextId] = cur.id;
          const [, nlat, nlon] = this.graph.nodes[nextId];
          const h = haversine(nlat, nlon, toLat, toLon);
          heap.push({ id: nextId, f: tentative + h });
        }
      }
    }

    if (gScore[goal] === Infinity) return null;

    // 経路復元（ノードインデックスの列）
    const nodeIdx: number[] = [];
    let cur2 = goal;
    while (cur2 !== -1) {
      nodeIdx.push(cur2);
      cur2 = prev[cur2];
    }
    nodeIdx.reverse();

    // 経路復元（座標列のみ）
    const path: Array<[number, number]> = [];
    for (let i = 0; i < nodeIdx.length; i++) {
      const node = this.graph.nodes[nodeIdx[i]];
      path.push([node[1], node[2]]);
    }
    return { path, distanceM: gScore[goal] };
  }

  // メイン道路網（最大連結成分）内の最近ノードを選ぶ
  private mainComponent: Uint8Array | null = null;
  private nearestNodeInMainComponent(lat: number, lon: number): number {
    if (!this.mainComponent) this.computeMainComponent();
    let best = -1;
    let bestDist = Infinity;
    for (let i = 0; i < this.graph.nodes.length; i++) {
      if (!this.mainComponent![i]) continue;
      const [, nlat, nlon] = this.graph.nodes[i];
      const d = haversine(lat, lon, nlat, nlon);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  private computeMainComponent() {
    const n = this.graph.nodes.length;
    const visited = new Uint8Array(n);
    const mark = new Uint8Array(n);
    let bestSize = 0;
    let bestMark: Uint8Array | null = null;
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      // BFSで成分サイズ計測
      const stack = [i];
      visited[i] = 1;
      let size = 0;
      const local: number[] = [];
      while (stack.length) {
        const v = stack.pop()!;
        size++;
        local.push(v);
        for (const [w] of this.adjacency[v]) {
          if (!visited[w]) {
            visited[w] = 1;
            stack.push(w);
          }
        }
      }
      if (size > bestSize) {
        bestSize = size;
        bestMark = new Uint8Array(n);
        for (const v of local) bestMark[v] = 1;
      }
    }
    this.mainComponent = bestMark || new Uint8Array(n);
  }
}

// 新宿区の道路ネットワークをOverpassから取得し、A*経路探索用の簡略化グラフとしてR2へ保存する。
// 使い方: npm run collect:roads
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const BBOX = '(35.672,139.665,35.735,139.755)';

async function fetchRoads() {
  const query = `[out:json][timeout:300];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"]${BBOX};
);
out geom;`;
  let lastErr;
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'curl/8.5.0' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.log(`リトライ ${i + 1}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 6000 * (i + 1)));
    }
  }
  throw lastErr;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ノード: [id, lat, lon]。座標を5桁に丸め、同一座標は同一ノードに統合
function buildGraph(elements) {
  const nodeMap = new Map(); // "lat,lon" -> id
  const nodes = [];
  const edges = []; // [fromId, toId, distM]
  let nextId = 0;

  for (const way of elements) {
    const geom = way.geometry || [];
    const ids = [];
    for (const p of geom) {
      const lat = Number(p.lat.toFixed(5));
      const lon = Number(p.lon.toFixed(5));
      const key = `${lat},${lon}`;
      let id = nodeMap.get(key);
      if (id === undefined) {
        id = nextId++;
        nodeMap.set(key, id);
        nodes.push([id, lat, lon]);
      }
      ids.push(id);
    }
    for (let i = 0; i < ids.length - 1; i++) {
      if (ids[i] === ids[i + 1]) continue;
      const a = nodes[ids[i]];
      const b = nodes[ids[i + 1]];
      const dist = haversine(a[1], a[2], b[1], b[2]);
      if (dist < 0.1) continue;
      edges.push([ids[i], ids[i + 1], Number(dist.toFixed(1))]);
    }
  }

  return { nodes, edges };
}

async function main() {
  console.log('Overpassから道路を取得中...');
  const data = await fetchRoads();
  const { nodes, edges } = buildGraph(data.elements);
  const graph = { nodes, edges };
  const tmp = '/tmp/opencode/shinjuku-roads.json';
  writeFileSync(tmp, JSON.stringify(graph));
  console.log(`道路グラフ: ${nodes.length} ノード / ${edges.length} エッジ (${(graph.nodes.length * 40 + graph.edges.length * 18) / 1e6}MB概算)`);
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'odh-raw/roads/shinjuku-roads.json', '--file', tmp, '--remote', '--content-type', 'application/json'], {
    stdio: 'inherit',
  });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

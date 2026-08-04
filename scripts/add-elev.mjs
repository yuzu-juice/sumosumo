// 道路グラフの各ノードに標高を付与し、R2へ再アップロードする。
// 標高は国土地理院の標高タイルテキスト形式(dem, z14)から取得。実行時は外部API不要。
// 出典: 国土地理院 標高タイル（基盤地図情報数値標高モデル DEM10B）
// 使い方: npm run add:elev
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const Z = 14;
const TILE_SIZE = 360 / 2 ** Z; // 経度方向のタイル幅

// Webメルカトル: yタイル番号 -> タイル上端緯度
function ytileToLat(y) {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** Z))) * 180) / Math.PI;
}

async function fetchTileTxt(x, y) {
  const url = `https://cyberjapandata.gsi.go.jp/xyz/dem/${Z}/${x}/${y}.txt`;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'odh-tokyo-qol/0.1 (open data hackathon)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function parseTile(text) {
  return text.trim().split('\n').map((line) => line.split(',').map(Number));
}

function elevAt(grid, tileX, tileY, lat, lon) {
  const lon0 = tileX * TILE_SIZE - 180;
  const latTop = ytileToLat(tileY);
  const latBottom = ytileToLat(tileY + 1);
  const px = Math.floor(((lon - lon0) / TILE_SIZE) * 256);
  const py = Math.floor(((latTop - lat) / (latTop - latBottom)) * 256);
  if (px < 0 || px > 255 || py < 0 || py > 255) return null;
  return grid[py]?.[px] ?? null;
}

function tileFor(lat, lon) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** Z);
  const y = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * 2 ** Z);
  return { x, y };
}

async function main() {
  const graph = JSON.parse(readFileSync('/tmp/opencode/roads.json', 'utf-8'));
  const tiles = new Map();
  let missing = 0;
  for (const node of graph.nodes) {
    const [, lat, lon] = node;
    const { x, y } = tileFor(lat, lon);
    const key = `${x}-${y}`;
    if (!tiles.has(key)) {
      try {
        tiles.set(key, parseTile(await fetchTileTxt(x, y)));
      } catch {
        tiles.set(key, null);
      }
    }
    const grid = tiles.get(key);
    const elev = grid ? elevAt(grid, x, y, lat, lon) : null;
    if (elev === null) missing++;
    node.push(elev ?? 0); // [id, lat, lon, elev]
  }
  writeFileSync('/tmp/opencode/roads-elev.json', JSON.stringify(graph));
  console.log(`標高付与: ${graph.nodes.length} ノード (取得不可 ${missing})`);
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'odh-raw/roads/shinjuku-roads.json', '--file', '/tmp/opencode/roads-elev.json', '--remote', '--content-type', 'application/json'], { stdio: 'inherit' });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

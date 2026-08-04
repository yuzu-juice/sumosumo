// 新宿区周辺の地図タイルをOSMタイルサーバーから取得し、R2へ保存する。
// 実行時はこのR2から自前配信し、OSMタイルサーバーには依存しない（収集は一度だけ）。
// 使い方:
//   npm run collect:tiles            # 新宿区周辺 z13-17
//   TILE_MIN_Z=16 TILE_MAX_Z=17 npm run collect:tiles   # 新宿区詳細のみ
// デフォルトbboxは新宿区周辺（低ズームで地図が切れないように広めに取る）
import { execFileSync, execFile } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SOUTH = Number(process.env.TILE_SOUTH || 35.60);
const WEST = Number(process.env.TILE_WEST || 139.60);
const NORTH = Number(process.env.TILE_NORTH || 35.78);
const EAST = Number(process.env.TILE_EAST || 139.82);
const MIN_Z = Number(process.env.TILE_MIN_Z || 13);
const MAX_Z = Number(process.env.TILE_MAX_Z || 17);
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

function tileCoords(lat, lon, z) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** z);
  const y = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2) * 2 ** z);
  return { x, y };
}

async function fetchTile(z, x, y) {
  const url = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'odh-tokyo-qol/0.1 (open data hackathon)' } });
      if (!res.ok) {
        // 404（海域・タイルなし）はスキップ、それ以外はリトライ
        if (res.status === 404) return null;
        throw new Error(`HTTP ${res.status}`);
      }
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

async function main() {
  const tiles = [];
  for (let z = MIN_Z; z <= MAX_Z; z++) {
    const sw = tileCoords(SOUTH, EAST, z);
    const ne = tileCoords(NORTH, WEST, z);
    for (let x = ne.x; x <= sw.x; x++) {
      for (let y = ne.y; y <= sw.y; y++) {
        tiles.push({ z, x, y });
      }
    }
  }
  console.log(`収集対象タイル: ${tiles.length} 枚 (z${MIN_Z}-${MAX_Z})`);

  const tmpDir = '/tmp/opencode/tiles';
  const { mkdirSync } = await import('node:fs');
  mkdirSync(tmpDir, { recursive: true });

  let done = 0, skipped = 0;
  for (const t of tiles) {
    const buf = await fetchTile(t.z, t.x, t.y);
    if (buf === null) { skipped++; continue; }
    const file = join(tmpDir, `${t.z}-${t.x}-${t.y}.png`);
    writeFileSync(file, buf);
    done++;
    if (done % 100 === 0) console.log(`${done}/${tiles.length} (skip ${skipped})`);
  }

  // R2へアップロード（./tiles/ キー、並列8）
  const jobs = tiles.filter((t) => existsSync(join(tmpDir, `${t.z}-${t.x}-${t.y}.png`)));
  let idx = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (idx < jobs.length) {
      const t = jobs[idx++];
      const file = join(tmpDir, `${t.z}-${t.x}-${t.y}.png`);
      await new Promise((resolve, reject) => {
        execFile('npx', ['wrangler', 'r2', 'object', 'put', `odh-raw/tiles/${t.z}/${t.x}/${t.y}.png`, '--file', file, '--remote', '--content-type', 'image/png'], { stdio: 'inherit' }, (err) => (err ? reject(err) : resolve()));
      });
    }
  });
  await Promise.all(workers);
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

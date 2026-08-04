// 新宿区の浸水想定区域（東京都建設局 神田川流域浸水予想区域図）をグリッド集約してR2へ保存する。
// 出典: https://www.opendata.metro.tokyo.lg.jp/kensetsu/R3/shinsui_kandagawa.csv
// 使い方: npm run collect:flood
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const FLOOD_CSV = 'https://www.opendata.metro.tokyo.lg.jp/kensetsu/R3/shinsui_kandagawa.csv';

async function main() {
  const res = await fetch(FLOOD_CSV, { headers: { 'User-Agent': 'curl/8.5.0' } });
  if (!res.ok) throw new Error(`CSV取得失敗 ${res.status}`);
  const text = await res.text();
  const lines = text.replace(/\r/g, '').split('\n').filter(Boolean);
  const cells = new Map();
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const depth = Number(cols[1]);
    const lat = Number(cols[3]);
    const lon = Number(cols[4]);
    if (!Number.isFinite(depth) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (lat < 35.672 || lat > 35.735 || lon < 139.665 || lon > 139.755) continue;
    if (depth <= 0.5) continue;
    const key = `${Math.round(lat * 1000)},${Math.round(lon * 1000)}`;
    const cur = cells.get(key);
    if (!cur || depth > cur) cells.set(key, depth);
  }
  const data = Array.from(cells.entries()).map(([k, depth]) => {
    const [la, lo] = k.split(',').map(Number);
    return { lat: la / 1000, lon: lo / 1000, depth: Math.round(depth * 100) / 100 };
  });
  console.log(`浸水セル: ${data.length} 件`);
  const tmp = '/tmp/opencode/shinjuku-flood.json';
  writeFileSync(tmp, JSON.stringify(data));
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'odh-raw/flood/shinjuku-flood.json', '--file', tmp, '--remote', '--content-type', 'application/json'], { stdio: 'inherit' });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

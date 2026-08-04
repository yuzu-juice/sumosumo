// 新宿区の行政境界ポリゴン（OSMリレーション）をR2へ保存する。
// 地図上の対象範囲表示（ハッチの内側=選択可能）に使用。
// 使い方: npm run collect:boundary
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REL_ID = 1758858; // 新宿区 boundary=administrative

async function fetchBoundary() {
  const query = `[out:json][timeout:120];rel(${REL_ID});out geom;`;
  let lastErr;
  for (let i = 0; i < 5; i++) {
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
      await new Promise((r) => setTimeout(r, 8000 * (i + 1)));
    }
  }
  throw lastErr;
}

async function main() {
  const data = await fetchBoundary();
  const rel = data.elements[0];
  if (!rel) throw new Error('境界リレーションが見つかりません');
  const ways = rel.members.filter((m) => m.type === 'way' && m.geometry);

  // 全ウェイの座標を連結し、重複点を除去して閉ループにする
  const coords = [];
  for (const w of ways) {
    for (const p of w.geometry) {
      coords.push([Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))]);
    }
  }
  const ring = [];
  for (const c of coords) {
    if (ring.length && ring[ring.length - 1][0] === c[0] && ring[ring.length - 1][1] === c[1]) continue;
    ring.push(c);
  }
  // 閉ループ保証
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push(ring[0]);
  }

  const geojson = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '新宿区', admin_level: 7 },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };
  const tmp = '/tmp/opencode/shinjuku-boundary.geojson';
  writeFileSync(tmp, JSON.stringify(geojson));
  console.log(`境界ポリゴン: ${ring.length} 点を保存`);
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'odh-raw/boundary/shinjuku.geojson', '--file', tmp, '--remote', '--content-type', 'application/json'], { stdio: 'inherit' });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// 新宿区の浸水想定区域（河川浸水 + 高潮）をグリッド集約してR2へ保存する。
// 河川: 東京都建設局 神田川流域浸水予想区域図
//   出典: https://www.opendata.metro.tokyo.lg.jp/kensetsu/R3/shinsui_kandagawa.csv
// 高潮: 東京都港湾局 高潮浸水想定区域図（想定最大規模）SHP/DBF
//   出典: https://catalog.data.metro.tokyo.lg.jp/dataset/t000014d0000000029
// 使い方: npm run collect:flood
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';

const FLOOD_CSV = 'https://www.opendata.metro.tokyo.lg.jp/kensetsu/R3/shinsui_kandagawa.csv';

// ===== 高潮DBFの平面直角座標(第9系) → 緯度経度 変換 =====
const A = 6378137;
const F = 1 / 298.257222101;
const M0 = 0.9999;
const LAT0 = (36 * Math.PI) / 180;
const LON0 = (139.8333333333333 * Math.PI) / 180;
const E2 = F * (2 - F);

function meridianArc(lat) {
  return A * ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256) * lat
    - ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 ** 3) / 1024) * Math.sin(2 * lat)
    + ((15 * E2 * E2) / 256 + (45 * E2 ** 3) / 1024) * Math.sin(4 * lat)
    - ((35 * E2 ** 3) / 3072) * Math.sin(6 * lat));
}

function xyToLonLat(x, y) {
  const X = x / M0;
  const Y = y / M0;
  const m0arc = meridianArc(LAT0);
  const df = A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256);
  let phi = LAT0 + Y / df;
  for (let i = 0; i < 30; i++) {
    const next = phi - (meridianArc(phi) - m0arc - Y) / (A * Math.sqrt(1 - E2 * Math.sin(phi) ** 2));
    if (Math.abs(next - phi) < 1e-14) { phi = next; break; }
    phi = next;
  }
  const t = Math.tan(phi);
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const N = A / Math.sqrt(1 - E2 * sinP * sinP);
  const R = (A * (1 - E2)) / Math.pow(1 - E2 * sinP * sinP, 1.5);
  const eta2 = (N - R) / R;
  const dLon = (X / (N * cosP))
    - (X ** 3 / (6 * N ** 3 * cosP)) * (1 + 2 * t * t + eta2)
    - (X ** 5 / (120 * N ** 5 * cosP)) * (5 + 28 * t * t + 24 * t ** 4 + 6 * eta2 + 8 * eta2 * t * t);
  const lat = phi
    - (N * t / R) * (X ** 2 / (2 * N * N))
    - (N * t / R) * (X ** 4 / (24 * N ** 4)) * (5 + 3 * t * t + 10 * eta2 - 4 * eta2 * eta2 - 9 * eta2 * t * t)
    - (N * t / R) * (X ** 6 / (720 * N ** 6)) * (61 + 90 * t * t + 45 * t ** 4);
  return [(LON0 + dLon) * 180 / Math.PI, lat * 180 / Math.PI];
}

// DBF (dBase III) を読み X,Y,DepthM を返す
function parseDbf(path) {
  const buf = readFileSync(path);
  const numRec = buf.readUInt32LE(4);
  const hdrLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields = [];
  let off = 32;
  while (buf[off] !== 0x0d) {
    const name = buf.toString('ascii', off, off + 11).replace(/\0/g, '');
    const len = buf.readUInt8(off + 16);
    fields.push({ name, len });
    off += 32;
  }
  const rows = [];
  let pos = hdrLen;
  for (let i = 0; i < numRec && pos + recLen <= buf.length; i++) {
    const row = {};
    let p = pos + 1;
    for (const fld of fields) {
      row[fld.name] = buf.toString('utf8', p, p + fld.len).trim();
      p += fld.len;
    }
    rows.push(row);
    pos += recLen;
  }
  return rows;
}

// 高潮データの図郭番号（新宿区を含む）
const STORM_DBF_DIR = '/tmp/opencode/takashio/shape(depth)';
const STORM_SHEETS = ['0307', '0407', '0408', '0409'];
// 境界判定用の新宿区外環（平面直角座標系へ変換済み）
const BOUNDARY_PATH = '/tmp/opencode/shinjuku-boundary.geojson';

function loadBoundaryXY() {
  const geo = JSON.parse(readFileSync(BOUNDARY_PATH, 'utf8'));
  const ring = geo.features[0].geometry.coordinates[0];
  return ring.map(([lon, lat]) => {
    // 緯度経度 → 平面直角座標（x,y）
    const phi = (lat * Math.PI) / 180;
    const dLon = (lon * Math.PI) / 180 - LON0;
    const t = Math.tan(phi);
    const cosP = Math.cos(phi);
    const N = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
    const R = (A * (1 - E2)) / Math.pow(1 - E2 * Math.sin(phi) ** 2, 1.5);
    const eta2 = (N - R) / R;
    const x = M0 * (N * dLon * cosP
      + (N * dLon ** 3 * cosP ** 3) / 6 * (1 - t * t + eta2)
      + (N * dLon ** 5 * cosP ** 5) / 120 * (5 - 18 * t * t + t ** 4 + 14 * eta2 - 58 * t * t * eta2 + 13 * eta2 * eta2));
    const y = M0 * ((meridianArc(phi) - meridianArc(LAT0))
      + (N * t * dLon ** 2 * cosP ** 2) / 2
      + (N * t * dLon ** 4 * cosP ** 4) / 24 * (5 - t * t + 9 * eta2 + 4 * eta2 * eta2)
      + (N * t * dLon ** 6 * cosP ** 6) / 720 * (61 - 58 * t * t + t ** 4 + 270 * eta2 - 330 * t * t * eta2));
    return [x, y];
  });
}

function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

async function fetchRiverCells() {
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
  return Array.from(cells.entries()).map(([k, depth]) => {
    const [la, lo] = k.split(',').map(Number);
    return { lat: la / 1000, lon: lo / 1000, depth: Math.round(depth * 100) / 100, type: 'river' };
  });
}

function fetchStormCells() {
  const ring = loadBoundaryXY();
  const cells = new Map();
  for (const sheet of STORM_SHEETS) {
    for (const r of parseDbf(`${STORM_DBF_DIR}/${sheet}.dbf`)) {
      const x = Number(r.X), y = Number(r.Y), d = Number(r.DepthM);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(d)) continue;
      if (d <= 0.5) continue;
      if (!pointInPolygon(x, y, ring)) continue;
      const [lon, lat] = xyToLonLat(x, y);
      const key = `${Math.round(lat * 1000)},${Math.round(lon * 1000)}`;
      const cur = cells.get(key);
      if (!cur || d > cur) cells.set(key, d);
    }
  }
  return Array.from(cells.entries()).map(([k, depth]) => {
    const [la, lo] = k.split(',').map(Number);
    return { lat: la / 1000, lon: lo / 1000, depth: Math.round(depth * 100) / 100, type: 'storm' };
  });
}

async function main() {
  const river = await fetchRiverCells();
  const storm = fetchStormCells();
  const data = [...river, ...storm];
  console.log(`河川浸水: ${river.length} 件`);
  console.log(`高潮浸水: ${storm.length} 件`);
  console.log(`合計: ${data.length} 件`);
  const tmp = '/tmp/opencode/shinjuku-flood.json';
  writeFileSync(tmp, JSON.stringify(data));
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', 'odh-raw/flood/shinjuku-flood.json', '--file', tmp, '--remote', '--content-type', 'application/json'], { stdio: 'inherit' });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

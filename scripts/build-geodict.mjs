// 新宿区の公式オープンデータから町丁目→座標の住所辞書をD1へ投入する。
// 実行時ジオコーディングはこの辞書のみを使い、外部API（Nominatim等）には依存しない。
// 使い方: npm run build:geodict
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB_NAME = process.env.DB_NAME || 'odh-db';
const UPDATED_AT = new Date().toISOString().slice(0, 10);

const CSV_SOURCES = [
  'https://www.city.shinjuku.lg.jp/content/000399984.csv', // 医療機関
  'https://www.city.shinjuku.lg.jp/content/000399965.csv', // 公共施設
  'https://www.city.shinjuku.lg.jp/content/000399985.csv', // 教育機関
];

async function fetchCsv(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'curl/8.5.0' } });
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('utf-16le');
}

function csvParse(text) {
  const rows = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (!lines.length) return rows;
  const header = lines[0].split(',').map((h) => h.replace(/^\ufeff/, '').trim());
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const vals = lines[i].split(',');
    const obj = {};
    header.forEach((h, idx) => (obj[h] = (vals[idx] ?? '').trim()));
    rows.push(obj);
  }
  return rows;
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

async function main() {
  const townPoints = new Map(); // 町丁目 -> [{lat,lon}]
  const addrCount = new Map();

  for (const url of CSV_SOURCES) {
    const rows = csvParse(await fetchCsv(url));
    for (const r of rows) {
      const town = r['所在地_町字'] || r['教育機関_学校所在地（町字）'] || '';
      const lat = Number(r['緯度'] || r['教育機関_緯度']);
      const lon = Number(r['経度'] || r['教育機関_経度']);
      if (!town || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!addrCount.has(town)) addrCount.set(town, 0);
      addrCount.set(town, addrCount.get(town) + 1);
      if (!townPoints.has(town)) townPoints.set(town, []);
      townPoints.get(town).push({ lat, lon });
    }
  }

  const lines = ['DELETE FROM address_dict;'];
  for (const [town, pts] of townPoints) {
    const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
    lines.push(
      `INSERT INTO address_dict (town, lat, lon, n_samples) VALUES ('${sqlEscape(town)}', ${lat.toFixed(6)}, ${lon.toFixed(6)}, ${pts.length});`,
    );
  }

  const tmp = '/tmp/opencode/geodict.sql';
  writeFileSync(tmp, lines.join('\n'));
  console.log(`住所辞書: ${townPoints.size} 町丁目をD1へ投入`);
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', `--file=${tmp}`], {
    stdio: 'inherit',
  });
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

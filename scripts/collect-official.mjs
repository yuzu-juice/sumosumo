// 新宿区の公式オープンデータをD1へ投入するスクリプト。
// 実行時のアプリはD1のみ参照し、外部APIには一切依存しない。
// 使い方: npm run collect:official
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB_NAME = process.env.DB_NAME || 'odh-db';
const UPDATED_AT = new Date().toISOString().slice(0, 10);

const SOURCES = [
  {
    category: 'medical',
    note: '新宿区 医療機関一覧',
    csv: 'https://www.city.shinjuku.lg.jp/content/000399984.csv',
    encoding: 'utf-16le',
    nameKey: '名称',
    latKey: '緯度',
    lonKey: '経度',
    addrKeys: ['所在地_連結表記'],
    deptKey: '診療科目',
    match: (name) => /クリニック|診療所|医院/.test(name) && !/薬局|薬店/.test(name),
  },
  {
    category: 'public',
    note: '新宿区 公共施設一覧',
    csv: 'https://www.city.shinjuku.lg.jp/content/000399965.csv',
    encoding: 'utf-16le',
    nameKey: '名称',
    latKey: '緯度',
    lonKey: '経度',
    addrKeys: ['所在地_連結表記'],
    match: (name) => true,
  },
  {
    category: 'education',
    note: '新宿区 教育機関一覧',
    csv: 'https://www.city.shinjuku.lg.jp/content/000399985.csv',
    encoding: 'utf-16le',
    nameKey: '教育機関_学校名',
    latKey: '教育機関_緯度',
    lonKey: '教育機関_経度',
    addrKeys: ['教育機関_学校所在地（市区町村）', '教育機関_学校所在地（町字）', '教育機関_学校所在地（番地以下）'],
    match: (name) => true,
  },
];

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

async function fetchCsv(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'curl/8.5.0' } });
  if (!res.ok) throw new Error(`CSV取得失敗 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('utf-16le');
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function generateSql(category, rows) {
  const lines = [
    `DELETE FROM facilities WHERE category = '${category}' AND source LIKE '新宿区%';`,
    ...rows.map(
      (r) =>
        `INSERT INTO facilities (category, name, lat, lon, address, department, source, updated_at) VALUES ('${category}', '${sqlEscape(r.name)}', ${r.lat}, ${r.lon}, '${sqlEscape(r.address)}', ${r.department !== null ? `'${sqlEscape(r.department)}'` : 'NULL'}, '${sqlEscape(r.source)}', '${UPDATED_AT}');`,
    ),
  ];
  return lines.join('\n');
}

async function main() {
  for (const src of SOURCES) {
    const text = await fetchCsv(src.csv);
    const rows = csvParse(text);
    const out = [];
    for (const r of rows) {
      const name = r[src.nameKey] || '';
      const lat = Number(r[src.latKey]);
      const lon = Number(r[src.lonKey]);
      if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!src.match(name)) continue;
      const address = src.addrKeys.map((k) => r[k] || '').join('');
      const department = src.deptKey ? (r[src.deptKey] || '').trim() || null : null;
      out.push({ name, lat, lon, address, department, source: `${src.note}（新宿区）` });
    }
    const seen = new Set();
    const uniq = out.filter((r) => {
      const k = `${r.name}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const sql = generateSql(src.category, uniq);
    const tmp = `/tmp/opencode/official-${src.category}.sql`;
    writeFileSync(tmp, sql);
    console.log(`${src.category}: ${uniq.length} 件 (${src.note})`);
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', `--file=${tmp}`], {
      stdio: 'inherit',
    });
  }
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

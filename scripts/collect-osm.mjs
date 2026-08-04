// ローカルでOSM施設データを収集し、D1へ直接投入するスクリプト。
// 注意: Overpass API は Cloudflare Workers からのアクセスを 406 でブロックするため、
// OSM 施設データの更新はこのスクリプトをローカル実行する。
// 使い方: npm run collect:osm
import { execFileSync } from 'node:child_process';

const CATEGORIES = ['shopping', 'medical', 'transport'];

const CATEGORY_TAGS = {
  // 買い物: スーパー・コンビニ・デパート・ドラッグストア・100均
  shopping: [
    'shop=supermarket',
    'shop=convenience',
    'shop=department_store',
    'shop=mall',
    'shop=chemist',
    'shop=drugstore',
    'shop=variety_store',
    'shop=bakery',
    'shop=greengrocer',
  ],
  // 医療: 病院・診療所・薬局・歯科
  medical: [
    'amenity=hospital',
    'amenity=clinic',
    'amenity=pharmacy',
    'amenity=dentist',
    'healthcare=doctor',
  ],
  transport: ['railway=station', 'railway=tram_stop', 'public_transport=station'],
};

function buildQuery(tag) {
  const [key, value] = tag.split('=');
  return `[out:json][timeout:120];\n(\n  node["${key}"="${value}"](35.672,139.665,35.735,139.755);\n);\nout center 1000;`;
}

async function fetchOverpass(tag) {
  const query = buildQuery(tag);
  let lastErr;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'curl/8.5.0',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      return json.elements;
    } catch (e) {
      lastErr = e;
      console.log(`${tag}: リトライ ${i + 1} (${e.message})`);
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  throw lastErr;
}

function toRow(el, category) {
  const coord =
    typeof el.lat === 'number' ? { lat: el.lat, lon: el.lon } : el.center || null;
  if (!coord) return null;
  const tags = el.tags || {};
  const name = tags['name:ja'] || tags.name || tags.brand || tags.operator || '';
  // 名前がない場合はカテゴリ名で代替
  const fallback = category === 'shopping' ? '店舗' : category === 'medical' ? '医療機関' : category === 'transport' ? '駅' : '施設';
  return { category, name: name || fallback, lat: coord.lat, lon: coord.lon, address: '' };
}

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
}

function generateSql(category, rows) {
  const updatedAt = new Date().toISOString().slice(0, 10);
  // OSM由来のみ削除（新宿区公式データは保持）
  const lines = [
    `DELETE FROM facilities WHERE category = '${category}' AND source = 'OpenStreetMap';`,
    ...rows.map(
      (r) =>
        `INSERT INTO facilities (category, name, lat, lon, address, source, updated_at) VALUES ('${category}', '${sqlEscape(r.name)}', ${r.lat}, ${r.lon}, '${sqlEscape(r.address)}', 'OpenStreetMap', '${updatedAt}');`,
    ),
  ];
  return lines.join('\n');
}

const DB_NAME = process.env.DB_NAME || 'odh-db';

// 近接ノードをクラスタリングして代表点にまとめる（駅の複数プラットフォーム等）
function clusterStations(rows, radiusM = 250) {
  const clusters = [];
  for (const row of rows) {
    let placed = false;
    for (const c of clusters) {
      const d = haversine(row.lat, row.lon, c.lat, c.lon);
      if (d <= radiusM) {
        c.lat = (c.lat * c.n + row.lat) / (c.n + 1);
        c.lon = (c.lon * c.n + row.lon) / (c.n + 1);
        c.n++;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ ...row, n: 1 });
  }
  return clusters.map((c) => ({ category: c.category, name: c.name, lat: c.lat, lon: c.lon, address: c.address }));
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

async function main() {
  for (const category of CATEGORIES) {
    let rows = [];
    for (const tag of CATEGORY_TAGS[category]) {
      const elements = await fetchOverpass(tag);
      rows.push(...elements.map((el) => toRow(el, category)).filter((x) => x !== null));
    }
    // 重複除去（同一名・同座標）
    const seen = new Set();
    rows = rows.filter((r) => {
      const k = `${r.name}|${r.lat.toFixed(4)}|${r.lon.toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // 駅・交通は近接ノードをクラスタリングして1点に（プラットフォームの重複を解消）
    if (category === 'transport') rows = clusterStations(rows, 250);
    const sql = generateSql(category, rows);
    const tmp = `/tmp/opencode/osm-${category}.sql`;
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tmp, sql);
    console.log(`${category}: ${rows.length} 件をD1へ投入`);
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

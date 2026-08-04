// 新宿区の「町丁目プロフィール」用データをD1へ投入するスクリプト。
// 人口・AED・公衆トイレ・公園・指定緊急避難場所・通学区域
// 使い方: npm run collect:profile
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const DB_NAME = process.env.DB_NAME || 'odh-db';
const UPDATED_AT = new Date().toISOString().slice(0, 10);

const TOWN_CSV = 'https://www.city.shinjuku.lg.jp/content/000399968.csv'; // 人口
const AED_CSV = 'https://www.city.shinjuku.lg.jp/content/000399971.csv'; // AED
const TOILET_CSV = 'https://www.city.shinjuku.lg.jp/content/000399974.csv'; // トイレ
const PARK_CSV = 'https://www.opendata.metro.tokyo.lg.jp/shinjyuku/131041_shinjukuku_toshitoritukouen.csv'; // 公園
const SHELTER_CSV = 'https://www.city.shinjuku.lg.jp/content/000399967.csv'; // 指定緊急避難場所
const ZONE_CSV = 'https://www.city.shinjuku.lg.jp/content/000399976.csv'; // 通学区域

function sqlEscape(s) {
  return String(s).replace(/'/g, "''");
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

async function fetchUtf16(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'curl/8.5.0' } });
  if (!res.ok) throw new Error(`CSV取得失敗 ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('utf-16le');
}

async function fetchUtf8(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'curl/8.5.0' } });
  if (!res.ok) throw new Error(`CSV取得失敗 ${res.status}: ${url}`);
  return await res.text();
}

function exec(sql) {
  const tmp = '/tmp/opencode/profile.sql';
  writeFileSync(tmp, sql);
  execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', `--file=${tmp}`], {
    stdio: 'inherit',
  });
}

// 人口: 町丁目名を正規化してD1 address_dict の town と照合する
function normalizeTown(name) {
  // 全角数字を半角に、単位を揃える
  return name
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\s+/g, '')
    .replace('丁目', '');
}

async function collectDemographics() {
  const text = await fetchUtf16(TOWN_CSV);
  const rows = csvParse(text);
  // address_dict から町丁目名と座標を取得
  const dict = await execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', 'SELECT town, lat, lon FROM address_dict'], { encoding: 'utf8' });
  const dictRows = JSON.parse(dict).filter((r) => r.results && r.results.length)[0]?.results ?? [];
  const townMap = new Map();
  for (const d of dictRows) townMap.set(normalizeTown(d.town), d);

  const lines = [`DELETE FROM demographics;`];
  let matched = 0;
  for (const r of rows) {
    const town = r['地域名'] || '';
    const total = Number(r['総人口']);
    if (!town || !Number.isFinite(total)) continue;
    const norm = normalizeTown(town);
    const geo = townMap.get(norm);
    if (!geo) continue;
    matched++;
    const age = (k) => Number(r[`${k}の男性`] || 0) + Number(r[`${k}の女性`] || 0);
    const households = Number(r['世帯数'] || 0);
    lines.push(
      `INSERT INTO demographics (town, lat, lon, total_pop, households, age_0_4, age_5_9, age_10_14, age_15_19, age_20_24, age_25_29, age_30_34, age_35_39, age_40_44, age_45_49, age_50_54, age_55_59, age_60_64, age_65_69, age_70_74, age_75_79, age_80_84, age_85_plus, updated_at) VALUES ('${sqlEscape(town)}', ${geo.lat}, ${geo.lon}, ${total}, ${Number.isFinite(households) ? households : 'NULL'}, ${age('0-4歳')}, ${age('5-9歳')}, ${age('10-14歳')}, ${age('15-19歳')}, ${age('20-24歳')}, ${age('25-29歳')}, ${age('30-34歳')}, ${age('35-39歳')}, ${age('40-44歳')}, ${age('45-49歳')}, ${age('50-54歳')}, ${age('55-59歳')}, ${age('60-64歳')}, ${age('65-69歳')}, ${age('70-74歳')}, ${age('75-79歳')}, ${age('80-84歳')}, ${age('85歳以上')}, '${UPDATED_AT}');`,
    );
  }
  console.log(`人口: ${matched} 町丁目を投入`);
  exec(lines.join('\n'));
}

function num(row, key) {
  const raw = (row[key] ?? '').trim();
  if (raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

async function collectAed() {
  const text = await fetchUtf16(AED_CSV);
  const rows = csvParse(text);
  const lines = [`DELETE FROM aed;`];
  let n = 0;
  for (const r of rows) {
    const name = r['名称'] || '';
    const lat = num(r, '緯度');
    const lon = num(r, '経度');
    if (!name || lat === null || lon === null) continue;
    const pediatric = r['小児対応設備の有無'] === '有' ? 1 : 0;
    lines.push(
      `INSERT INTO aed (name, lat, lon, address, pediatric, updated_at) VALUES ('${sqlEscape(name)}', ${lat}, ${lon}, '${sqlEscape(r['所在地_連結表記'] || '')}', ${pediatric}, '${UPDATED_AT}');`,
    );
    n++;
  }
  console.log(`AED: ${n} 件`);
  exec(lines.join('\n'));
}

async function collectToilets() {
  const text = await fetchUtf16(TOILET_CSV);
  const rows = csvParse(text);
  const lines = [`DELETE FROM toilets;`];
  let n = 0;
  for (const r of rows) {
    const name = r['名称'] || '';
    const lat = num(r, '緯度');
    const lon = num(r, '経度');
    if (!name || lat === null || lon === null) continue;
    lines.push(
      `INSERT INTO toilets (name, lat, lon, address, barrier_free, kids, ostomate, updated_at) VALUES ('${sqlEscape(name)}', ${lat}, ${lon}, '${sqlEscape(r['所在地_連結表記'] || '')}', ${r['バリアフリートイレ数'] === '有' || Number(r['バリアフリートイレ数'] || 0) > 0 ? 1 : 0}, ${r['乳幼児用設備設置トイレ有無'] === '有' ? 1 : 0}, ${r['オストメイト設置トイレ有無'] === '有' ? 1 : 0}, '${UPDATED_AT}');`,
    );
    n++;
  }
  console.log(`公衆トイレ: ${n} 件`);
  exec(lines.join('\n'));
}

async function collectParks() {
  const text = await fetchUtf8(PARK_CSV);
  const rows = csvParse(text);
  const lines = [`DELETE FROM parks;`];
  let n = 0;
  for (const r of rows) {
    const name = r['名称'] || '';
    const lat = num(r, '緯度');
    const lon = num(r, '経度');
    if (!name || lat === null || lon === null) continue;
    const area = Number(r['面積(㎡)'] || 0);
    lines.push(
      `INSERT INTO parks (name, lat, lon, area_m2, updated_at) VALUES ('${sqlEscape(name)}', ${lat}, ${lon}, ${Number.isFinite(area) ? area : 0}, '${UPDATED_AT}');`,
    );
    n++;
  }
  console.log(`公園: ${n} 件`);
  exec(lines.join('\n'));
}

// address_dict から町丁目名→座標の辞書を作る（全角数字も半角に正規化）
async function loadTownDict() {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, '--remote', '--json', '--command', 'SELECT town, lat, lon FROM address_dict'], { encoding: 'utf8' });
  const rows = JSON.parse(out).filter((r) => r.results && r.results.length)[0]?.results ?? [];
  const map = new Map();
  for (const r of rows) {
    const norm = normalizeTown(r.town);
    if (!map.has(norm)) map.set(norm, { lat: r.lat, lon: r.lon });
  }
  return map;
}

// 町丁目名（例: 戸山、西新宿）から座標を探す
function findTownCoord(townDict, townName) {
  const norm = normalizeTown(townName);
  if (townDict.has(norm)) return townDict.get(norm);
  // 前方一致（例: 戸山 → 戸山1丁目）
  for (const [k, v] of townDict) {
    if (k.startsWith(norm) || norm.startsWith(k)) return v;
  }
  return null;
}

async function collectShelters() {
  const text = await fetchUtf16(SHELTER_CSV);
  const rows = csvParse(text);
  const townDict = await loadTownDict();
  const lines = [`DELETE FROM emergency_shelters;`];
  let n = 0;
  let geocoded = 0;
  for (const r of rows) {
    const name = r['名称'] || '';
    let lat = num(r, '緯度');
    let lon = num(r, '経度');
    const address = r['所在地_連結表記'] || r['所在地_町字'] || '';
    // 座標が空なら住所から最初の町丁目をジオコーディング
    if (lat === null || lon === null) {
      const towns = address.split(/[、,，]/).map((t) => t.replace(/東京都|新宿区/g, '')).filter(Boolean);
      for (const t of towns) {
        const coord = findTownCoord(townDict, t);
        if (coord) {
          lat = coord.lat;
          lon = coord.lon;
          geocoded++;
          break;
        }
      }
    }
    if (!name || lat === null || lon === null) continue;
    const f = (key) => (r[`災害種別_${key}`] ? 1 : 0);
    const cap = num(r, '想定収容人数');
    lines.push(
      `INSERT INTO emergency_shelters (name, lat, lon, flood, landslide, storm_surge, earthquake, fire, capacity, updated_at) VALUES ('${sqlEscape(name)}', ${lat}, ${lon}, ${f('洪水')}, ${f('崖崩れ、土石流及び地滑り')}, ${f('高潮')}, ${f('地震')}, ${f('大規模な火事')}, ${cap === null ? 'NULL' : cap}, '${UPDATED_AT}');`,
    );
    n++;
  }
  console.log(`指定緊急避難場所: ${n} 件（住所からジオコーディング ${geocoded} 件）`);
  exec(lines.join('\n'));
}

async function collectZones() {
  const text = await fetchUtf16(ZONE_CSV);
  const rows = csvParse(text);
  const lines = [`DELETE FROM school_zones;`];
  let n = 0;
  for (const r of rows) {
    const school = r['学校名称'] || '';
    const zone = r['通学区域の住所'] || '';
    if (!school || !zone) continue;
    lines.push(
      `INSERT INTO school_zones (school, zone_text, updated_at) VALUES ('${sqlEscape(school)}', '${sqlEscape(zone)}', '${UPDATED_AT}');`,
    );
    n++;
  }
  console.log(`通学区域: ${n} 校`);
  exec(lines.join('\n'));
}

async function main() {
  await collectDemographics();
  await collectAed();
  await collectToilets();
  await collectParks();
  await collectShelters();
  await collectZones();
  console.log('完了');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

import { Category, Facility, Rule } from '../types';
import { haversineM } from './distance';

export interface Demographics {
  town: string;
  lat: number;
  lon: number;
  totalPop: number;
  households: number | null;
  // 年齢階級（5歳刻み）の人口
  age0_4: number;
  age5_9: number;
  age10_14: number;
  age15_19: number;
  age20_24: number;
  age25_29: number;
  age30_34: number;
  age35_39: number;
  age40_44: number;
  age45_49: number;
  age50_54: number;
  age55_59: number;
  age60_64: number;
  age65_69: number;
  age70_74: number;
  age75_79: number;
  age80_84: number;
  age85Plus: number;
}

export interface NearbyFacility {
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
}

export interface EmergencyShelter {
  name: string;
  lat: number;
  lon: number;
  distanceM: number;
  flood: boolean;
  landslide: boolean;
  stormSurge: boolean;
  earthquake: boolean;
  fire: boolean;
  capacity: number | null;
}

export interface AnswerFacts {
  location: { lat: number; lon: number; displayName: string };
  facilities: Record<Category, Facility[]>;
  rules: Rule[];
  risk?: { town: string; collapseRank: number; fireRank: number; totalRank: number } | null;
  crime?: { town: string; totalCrimes: number; year: number } | null;
  flood?: { riverMax: number; stormMax: number } | null;
  demographics?: Demographics | null;
  aed?: NearbyFacility[] | null;
  toilets?: NearbyFacility[] | null;
  parks?: NearbyFacility[] | null;
  emergencyShelters?: EmergencyShelter[] | null;
  schoolZone?: string | null;
}

// 同座標の公共施設（図書館・区民ホール等）が並ぶため8件取得する
const LIMIT = 8;
const RADIUS_M = 3000;

// 徒歩時間（分）で「意味がある距離」を定義する。距離 = 徒歩分数 × 80m/分
const WALK_MIN_M: Record<Category, number> = {
  disaster: 15, // 避難所は災害時に徒歩で到達できる距離
  medical: 15,
  shopping: 15,
  transport: 20, // 駅は通勤圏として少し広め
  public: 10,
  education: 10,
  childcare: 10,
};
const WALK_SPEED_M_PER_MIN = 80;

// カテゴリごとの徒歩圏距離上限（m）
function maxDistM(category: Category): number {
  return WALK_MIN_M[category] * WALK_SPEED_M_PER_MIN;
}

function bbox(lat: number, lon: number, radiusM = RADIUS_M) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

export async function queryFacilities(
  db: D1Database,
  category: Category,
  lat: number,
  lon: number,
  limit = LIMIT,
): Promise<Facility[]> {
  const b = bbox(lat, lon);
  const res = await db
    .prepare(
      `SELECT id, category, name, lat, lon, address, department, source, updated_at AS updatedAt
       FROM facilities
       WHERE category = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
    )
    .bind(category, b.south, b.north, b.west, b.east)
    .all<Facility>();
  return (res.results ?? [])
    .map((f) => ({ ...f, distanceM: haversineM(lat, lon, f.lat, f.lon) }))
    .filter((f) => f.distanceM <= maxDistM(category))
    .sort((a, b) => {
      // 交通カテゴリは「駅」をバス停より優先
      if (category === 'transport') {
        const aIsStation = isStationName(a.name);
        const bIsStation = isStationName(b.name);
        if (aIsStation !== bIsStation) return aIsStation ? -1 : 1;
      }
      return a.distanceM - b.distanceM;
    })
    .slice(0, limit);
}

function isStationName(name: string): boolean {
  // 駅名は「〜駅」または一般的な駅名表記。バス停名は地名そのもの（歌舞伎町等）が多い
  return /駅$/.test(name) || /^[^がの]+駅/.test(name);
}

export async function queryRules(db: D1Database): Promise<Rule[]> {
  const res = await db
    .prepare(
      'SELECT id, category, ward, title, body, source, source_url AS sourceUrl, updated_at AS updatedAt FROM rules',
    )
    .all<Rule>();
  return res.results ?? [];
}

export async function gatherFacts(
  db: D1Database,
  lat: number,
  lon: number,
  flood?: AnswerFacts['flood'],
): Promise<AnswerFacts> {
  const categories: Category[] = [
    'shopping',
    'medical',
    'transport',
    'disaster',
    'public',
    'education',
    'childcare',
  ];
  const facilities = {} as AnswerFacts['facilities'];
  for (const c of categories) facilities[c] = await queryFacilities(db, c, lat, lon);
  const rules = await queryRules(db);
  const risk = await queryRiskByLocation(db, lat, lon);
  const crime = await queryCrimeByLocation(db, lat, lon);
  // 町丁目プロフィール（人口・AED・トイレ・公園・避難所・学区）を並行取得
  const [demographics, aed, toilets, parks, emergencyShelters, schoolZone] = await Promise.all([
    queryDemographics(db, lat, lon),
    queryNearbySimple(db, 'aed', lat, lon),
    queryNearbySimple(db, 'toilets', lat, lon),
    queryNearbySimple(db, 'parks', lat, lon),
    queryEmergencyShelters(db, lat, lon),
    querySchoolZone(db, lat, lon),
  ]);
  return {
    location: { lat, lon, displayName: '' },
    facilities,
    rules,
    risk,
    crime,
    flood,
    demographics,
    aed,
    toilets,
    parks,
    emergencyShelters,
    schoolZone,
  };
}

// 最寄り町丁目の地震危険度を返す
export async function queryRiskByLocation(
  db: D1Database,
  lat: number,
  lon: number,
): Promise<AnswerFacts['risk']> {
  const towns = await db
    .prepare('SELECT town, lat, lon FROM address_dict')
    .all<{ town: string; lat: number; lon: number }>();
  const nearest = nearestTown(towns.results ?? [], lat, lon);
  if (!nearest) return null;
  const risk = await db
    .prepare('SELECT town, collapse_rank, fire_rank, total_rank FROM risk_levels WHERE town = ?')
    .bind(nearest.town)
    .first<{ town: string; collapse_rank: number; fire_rank: number; total_rank: number }>();
  if (!risk) return null;
  return {
    town: risk.town,
    collapseRank: risk.collapse_rank,
    fireRank: risk.fire_rank,
    totalRank: risk.total_rank,
  };
}

// 最寄り町丁目の犯罪認知件数を返す
export async function queryCrimeByLocation(
  db: D1Database,
  lat: number,
  lon: number,
): Promise<AnswerFacts['crime']> {
  const towns = await db
    .prepare('SELECT town, lat, lon FROM address_dict')
    .all<{ town: string; lat: number; lon: number }>();
  const nearest = nearestTown(towns.results ?? [], lat, lon);
  if (!nearest) return null;
  const crime = await db
    .prepare('SELECT town, total_crimes, source_year FROM crime_stats WHERE town = ?')
    .bind(nearest.town)
    .first<{ town: string; total_crimes: number; source_year: number }>();
  if (!crime) return null;
  return { town: crime.town, totalCrimes: crime.total_crimes, year: crime.source_year };
}

function nearestTown(
  towns: Array<{ town: string; lat: number; lon: number }>,
  lat: number,
  lon: number,
): { town: string; lat: number; lon: number } | null {
  let best: { town: string; lat: number; lon: number } | null = null;
  let bestD = Infinity;
  for (const t of towns) {
    const d = Math.hypot(t.lat - lat, t.lon - lon);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return bestD < 0.02 ? best : null;
}

// 最寄り町丁目の年齢構成人口を返す
export async function queryDemographics(
  db: D1Database,
  lat: number,
  lon: number,
): Promise<AnswerFacts['demographics']> {
  // demographics テーブル自体から最寄り町丁目を探す（town名の表記差を避けるため座標ベース）
  const towns = await db.prepare('SELECT town, lat, lon FROM demographics').all<{ town: string; lat: number; lon: number }>();
  const nearest = nearestTown(towns.results ?? [], lat, lon);
  if (!nearest) return null;
  const d = await db
    .prepare('SELECT * FROM demographics WHERE town = ?')
    .bind(nearest.town)
    .first<any>();
  if (!d) return null;
  return {
    town: d.town,
    lat: d.lat,
    lon: d.lon,
    totalPop: d.total_pop,
    households: d.households,
    age0_4: d.age_0_4,
    age5_9: d.age_5_9,
    age10_14: d.age_10_14,
    age15_19: d.age_15_19,
    age20_24: d.age_20_24,
    age25_29: d.age_25_29,
    age30_34: d.age_30_34,
    age35_39: d.age_35_39,
    age40_44: d.age_40_44,
    age45_49: d.age_45_49,
    age50_54: d.age_50_54,
    age55_59: d.age_55_59,
    age60_64: d.age_60_64,
    age65_69: d.age_65_69,
    age70_74: d.age_70_74,
    age75_79: d.age_75_79,
    age80_84: d.age_80_84,
    age85Plus: d.age_85_plus,
  };
}

// 汎用の周辺施設クエリ（AED・トイレ・公園など）
async function queryNearbySimple(
  db: D1Database,
  table: string,
  lat: number,
  lon: number,
  limit = 3,
  radiusM = 1500,
): Promise<NearbyFacility[] | null> {
  const b = bbox(lat, lon, radiusM);
  const cols = table === 'parks' ? 'name, lat, lon, area_m2' : 'name, lat, lon';
  const res = await db
    .prepare(`SELECT ${cols} FROM ${table} WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`)
    .bind(b.south, b.north, b.west, b.east)
    .all<any>();
  return (res.results ?? [])
    .map((f) => ({ name: f.name, lat: f.lat, lon: f.lon, distanceM: haversineM(lat, lon, f.lat, f.lon) }))
    .filter((f) => f.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

// 最寄りの指定緊急避難場所（災害種別付き）を返す
export async function queryEmergencyShelters(
  db: D1Database,
  lat: number,
  lon: number,
): Promise<EmergencyShelter[] | null> {
  const b = bbox(lat, lon, 2000);
  const res = await db
    .prepare(
      `SELECT name, lat, lon, flood, landslide, storm_surge, earthquake, fire, capacity
       FROM emergency_shelters WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
    )
    .bind(b.south, b.north, b.west, b.east)
    .all<any>();
  const rows = (res.results ?? [])
    .map((s) => ({
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      distanceM: haversineM(lat, lon, s.lat, s.lon),
      flood: !!s.flood,
      landslide: !!s.landslide,
      stormSurge: !!s.storm_surge,
      earthquake: !!s.earthquake,
      fire: !!s.fire,
      capacity: s.capacity,
    }))
    .filter((s) => s.distanceM <= 2000)
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 3);
  return rows.length ? rows : null;
}

// 最寄り町丁目の通学区域（小学校）を返す
export async function querySchoolZone(
  db: D1Database,
  lat: number,
  lon: number,
): Promise<string | null> {
  // demographics から全角表記の町丁目名を取得して照合する
  const towns = await db.prepare('SELECT town, lat, lon FROM demographics').all<{ town: string; lat: number; lon: number }>();
  const nearest = nearestTown(towns.results ?? [], lat, lon);
  if (!nearest) return null;
  // 町丁目名を区域表記に合わせて正規化（例: 市谷加賀町２丁目 → 市谷加賀町二丁目）
  const norm = nearest.town
    .replace(/\s+/g, '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/(\d)丁目/, (_m, d) => `${['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'][Number(d)]}丁目`);
  const zones = await db
    .prepare('SELECT school, zone_text FROM school_zones')
    .all<{ school: string; zone_text: string }>();
  for (const z of zones.results ?? []) {
    // 区域テキストに町丁目名（正規化済み）が含まれるかを判定
    if (z.zone_text.replace(/\s+/g, '').includes(norm.replace('丁目', '丁目'))) {
      return z.school;
    }
  }
  return null;
}

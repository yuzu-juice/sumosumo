import { Category, Facility, Rule } from '../types';
import { haversineM } from './distance';

export interface AnswerFacts {
  location: { lat: number; lon: number; displayName: string };
  facilities: Record<Category, Facility[]>;
  rules: Rule[];
  risk?: { town: string; collapseRank: number; fireRank: number; totalRank: number } | null;
  crime?: { town: string; totalCrimes: number; year: number } | null;
  flood?: { riverMax: number; stormMax: number } | null;
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
  return { location: { lat, lon, displayName: '' }, facilities, rules, risk, crime, flood };
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

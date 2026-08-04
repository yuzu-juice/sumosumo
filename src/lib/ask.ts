import { Category, Facility, Rule } from '../types';
import { haversineM } from './distance';

export interface AnswerFacts {
  location: { lat: number; lon: number; displayName: string };
  facilities: Record<Exclude<Category, 'garbage'>, Facility[]>;
  rules: Rule[];
  risk?: { town: string; collapseRank: number; fireRank: number; totalRank: number } | null;
  crime?: { town: string; totalCrimes: number; year: number } | null;
}

const LIMIT = 5;
const RADIUS_M = 3000;

function bbox(lat: number, lon: number, radiusM = RADIUS_M) {
  const dLat = radiusM / 111320;
  const dLon = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
}

export async function queryFacilities(
  db: D1Database,
  category: Exclude<Category, 'garbage'>,
  lat: number,
  lon: number,
  limit = LIMIT,
): Promise<Facility[]> {
  const b = bbox(lat, lon);
  const res = await db
    .prepare(
      `SELECT id, category, name, lat, lon, address, source, updated_at AS updatedAt
       FROM facilities
       WHERE category = ? AND lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?`,
    )
    .bind(category, b.south, b.north, b.west, b.east)
    .all<Facility>();
  return (res.results ?? [])
    .map((f) => ({ ...f, distanceM: haversineM(lat, lon, f.lat, f.lon) }))
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

export async function gatherFacts(db: D1Database, lat: number, lon: number): Promise<AnswerFacts> {
  const categories: Array<Exclude<Category, 'garbage'>> = [
    'shopping',
    'medical',
    'transport',
    'disaster',
  ];
  const facilities = {} as AnswerFacts['facilities'];
  for (const c of categories) facilities[c] = await queryFacilities(db, c, lat, lon);
  const rules = await queryRules(db);
  const risk = await queryRiskByLocation(db, lat, lon);
  const crime = await queryCrimeByLocation(db, lat, lon);
  return { location: { lat, lon, displayName: '' }, facilities, rules, risk, crime };
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

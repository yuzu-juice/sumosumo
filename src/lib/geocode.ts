import { GeocodeResult } from '../types';

// 逆ジオコーディング: 緯度経度から最寄りの町丁目を返す（外部API非依存）
export async function reverseGeocode(db: D1Database, lat: number, lon: number): Promise<string> {
  const towns = await db
    .prepare('SELECT town, lat, lon FROM address_dict')
    .all<{ town: string; lat: number; lon: number }>();
  let best = '新宿区';
  let bestDist = Infinity;
  for (const t of towns.results ?? []) {
    const d = Math.hypot(t.lat - lat, t.lon - lon);
    if (d < bestDist) {
      bestDist = d;
      best = t.town;
    }
  }
  // 約0.02度（約2km）以内なら住所として採用
  return bestDist < 0.02 ? `東京都新宿区${best}` : '東京都新宿区';
}

// ジオコーディングはD1の住所辞書（新宿区公式オープンデータ由来）のみを使う。
// 外部API（Nominatim等）には依存しない。
export async function geocodeAddress(db: D1Database, address: string): Promise<GeocodeResult> {
  const normalized = address.replace(/東京都/, '').replace(/新宿区/, '').trim();

  // 町丁目（例: 西新宿4丁目 / 歌舞伎町 / 下落合）を最長一致で探す
  const town = findLongestTown(normalized);

  if (town) {
    const row = await db
      .prepare('SELECT lat, lon FROM address_dict WHERE town = ?')
      .bind(town)
      .first<{ lat: number; lon: number }>();
    if (row) {
      return {
        lat: row.lat,
        lon: row.lon,
        displayName: `東京都新宿区${town}`,
      };
    }
  }

  // 区レベルにフォールバック（新宿区役所の座標）
  const fallback = await db
    .prepare('SELECT lat, lon FROM facilities WHERE name = ?')
    .bind('新宿区役所（本庁舎）')
    .first<{ lat: number; lon: number }>();
  if (fallback) {
    return { lat: fallback.lat, lon: fallback.lon, displayName: '東京都新宿区（区役所地点）' };
  }

  throw new Error(
    `「${address}」は新宿区内の住所として認識できませんでした。town=${town ?? 'null'} normalized=${normalized}。例: 東京都新宿区西新宿1-1`,
  );
}

export function findLongestTown(normalized: string): string | null {
  // 正規化: 「西新宿4丁目12-3」→「西新宿4丁目」、「西新宿1-1」→「西新宿1丁目」、「歌舞伎町1-4-1」→「歌舞伎町」
  // 1. 丁目なしの町名（例: 歌舞伎町、北町、戸山）を最優先
  const townOnly = normalized.match(/([^0-9]+?町|[^0-9]+?村)/);
  if (townOnly) return townOnly[1].trim();
  // 2. 丁目付き（例: 西新宿4丁目）
  const withChome = normalized.match(/([^0-9]+?[0-9]+丁目)/);
  if (withChome) return withChome[1].trim();
  // 3. 番地のみ（例: 西新宿1-1）→ 数字の後の「丁目」補完
  const withBanchi = normalized.match(/([^0-9]+?)([0-9]+)-/);
  if (withBanchi) return `${withBanchi[1].trim()}${withBanchi[2]}丁目`;
  // 4. 番地（-なし）（例: 新宿3）
  const withNumber = normalized.match(/([^0-9]+?)([0-9]+)$/);
  if (withNumber) return `${withNumber[1].trim()}${withNumber[2]}丁目`;
  return null;
}

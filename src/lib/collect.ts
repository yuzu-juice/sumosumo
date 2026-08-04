import { Category } from '../types';

export interface Env {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
}

export interface CollectResult {
  category: Category;
  count: number;
  updatedAt: string;
}

const EVACUATION_CSV =
  'https://www.opendata.metro.tokyo.lg.jp/soumu/130001_evacuation_center.csv';
const WARD_CODE = '131041'; // 新宿区

interface EvacuationRow {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

export async function fetchEvacuationCenters(): Promise<EvacuationRow[]> {
  const res = await fetch(EVACUATION_CSV);
  if (!res.ok) throw new Error(`避難所CSV取得失敗 (HTTP ${res.status})`);
  const raw = await res.arrayBuffer();
  const text = new TextDecoder('shift_jis').decode(raw);
  const lines = text.split(/\r?\n/).filter(Boolean);
  const rows: EvacuationRow[] = [];
  for (const line of lines.slice(2)) {
    const cols = line.split(',');
    if (cols[1]?.trim() !== WARD_CODE) continue;
    const lat = Number(cols[5]);
    const lon = Number(cols[6]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    rows.push({ name: cols[0].trim(), address: cols[4].trim(), lat, lon });
  }
  return rows;
}

// Cron: 避難所データ（東京都公式）を収集してD1を更新する
export async function collectEvacuation(env: Env): Promise<CollectResult> {
  const category: Category = 'disaster';
  const updatedAt = new Date().toISOString().slice(0, 10);
  const rows = await fetchEvacuationCenters();

  await env.RAW_BUCKET.put(`raw/${category}-${updatedAt}.json`, JSON.stringify(rows));
  await env.DB.prepare('DELETE FROM facilities WHERE category = ?').bind(category).run();
  if (rows.length) {
    const stmt = env.DB.prepare(
      'INSERT INTO facilities (category, name, lat, lon, address, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    await env.DB.batch(
      rows.map((r) =>
        stmt.bind(category, r.name, r.lat, r.lon, r.address, '東京都防災マップ 避難所・避難場所一覧データ', updatedAt),
      ),
    );
  }
  return { category, count: rows.length, updatedAt };
}

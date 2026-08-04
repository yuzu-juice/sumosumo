// 浸水想定区域データ（河川・高潮）をR2から取得する共通ロジック

export type FloodCell = { lat: number; lon: number; depth: number; type?: string };

export type FloodInfo = { riverMax: number; stormMax: number } | null;

let floodCache: { at: number; data: FloodCell[] } | null = null;

// 選択地点周辺の最大浸水深（河川・高潮別）をR2から取得する
export async function loadNearbyFlood(
  bucket: R2Bucket,
  lat: number,
  lon: number,
): Promise<FloodInfo> {
  try {
    const cacheTtl = 15 * 60 * 1000;
    if (!floodCache || Date.now() - floodCache.at > cacheTtl) {
      const obj = await bucket.get('flood/shinjuku-flood.json');
      if (!obj) return null;
      floodCache = { at: Date.now(), data: (await obj.json()) as FloodCell[] };
    }
    const cells = floodCache.data;
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat);
    const cLat = Math.cos(dLat);
    let riverMax = 0;
    let stormMax = 0;
    for (const c of cells) {
      const dLatC = toRad(c.lat - lat);
      const dLonC = toRad(c.lon - lon);
      const h = Math.sin(dLatC / 2) ** 2 + cLat * Math.cos(toRad(c.lat)) * Math.sin(dLonC / 2) ** 2;
      const dist = R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
      if (dist > 500) continue;
      if ((c.type || 'river') === 'storm') {
        if (c.depth > stormMax) stormMax = c.depth;
      } else if (c.depth > riverMax) {
        riverMax = c.depth;
      }
    }
    return { riverMax, stormMax };
  } catch {
    return null;
  }
}

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { queryFacilities, queryRules, queryRiskByLocation, queryCrimeByLocation, queryDemographics, queryEmergencyShelters, querySchoolZone } from './lib/ask';
import { loadNearbyFlood } from './lib/flood';
import { geocodeAddress } from './lib/geocode';
import { formatDistance } from './lib/distance';
import { CATEGORY_LABELS, Category } from './types';
import type { Env } from './worker';

const CATEGORIES = ['shopping', 'medical', 'transport', 'disaster', 'public', 'education', 'childcare'] as const;

// 住所/緯度経度から基点を解決する共通ヘルパー
async function resolveCenter(
  env: Env,
  address?: string,
  lat?: number,
  lon?: number,
): Promise<{ lat: number; lon: number; displayName: string }> {
  if (address) return geocodeAddress(env.DB, address);
  return { lat: lat as number, lon: lon as number, displayName: '指定地点' };
}

export function buildMcpServer(env: Env): McpServer {
  const server = new McpServer({ name: 'sumosumo', version: '1.0.0' });

  server.registerTool(
    'geocode',
    {
      description: '住所を緯度経度に変換する。例: 東京都新宿区新宿1-1',
      inputSchema: z.object({ address: z.string().describe('住所') }),
      annotations: { readOnlyHint: true },
    },
    async ({ address }) => {
      try {
        const r = await geocodeAddress(env.DB, address);
        return {
          content: [{ type: 'text', text: JSON.stringify(r) }],
          structuredContent: r,
        };
      } catch (e) {
        throw new Error(`住所を解決できませんでした: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    'search_facilities',
    {
      description:
        '住所または緯度経度を基点に、指定カテゴリ（買い物/医療/交通/災害）の周辺施設を距離順に検索する。',
      inputSchema: z
        .object({
          category: z.enum(CATEGORIES).describe('施設カテゴリ'),
          address: z.string().optional().describe('住所（lat/lon未指定時は必須）'),
          lat: z.number().optional().describe('緯度'),
          lon: z.number().optional().describe('経度'),
          limit: z.number().int().min(1).max(10).default(5).describe('件数'),
        })
        .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
          message: 'address か lat/lon のどちらかが必要です',
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ category, address, lat, lon, limit }) => {
      const center = await resolveCenter(env, address, lat, lon);
      const cat = category as Category;
      const facs = await queryFacilities(env.DB, cat, center.lat, center.lon, limit);
      const rows = facs.map((f) => ({
        name: f.name,
        category: f.category,
        distance: formatDistance(f.distanceM),
        distanceM: f.distanceM,
        lat: f.lat,
        lon: f.lon,
        address: f.address,
        source: f.source,
        updatedAt: f.updatedAt,
      }));
      const text =
        rows.length === 0
          ? '該当する施設が周辺に見つかりませんでした'
          : rows.map((r) => `${r.name} (${r.distance}, 出典: ${r.source})`).join('\n');
      return { content: [{ type: 'text', text }], structuredContent: { center, rows } };
    },
  );

  server.registerTool(
    'get_rules',
    {
      description: '新宿区の生活ルール（ごみ分別・災害・医療など）を取得する。',
      inputSchema: z.object({
        category: z
          .enum(['garbage', 'disaster', 'medical'])
          .optional()
          .describe('ルールカテゴリ（省略時は全件）'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ category }) => {
      const rules = await queryRules(env.DB);
      const filtered = category ? rules.filter((r) => r.category === category) : rules;
      const rows = filtered.map((r) => ({
        category: r.category,
        title: r.title,
        body: r.body,
        source: r.source,
        sourceUrl: r.sourceUrl,
        updatedAt: r.updatedAt,
      }));
      const text =
        rows.length === 0
          ? 'ルールが見つかりませんでした'
          : rows.map((r) => `【${CATEGORY_LABELS[r.category as Category] ?? r.category}】${r.title}\n${r.body}\n出典: ${r.sourceUrl}`).join('\n\n');
      return { content: [{ type: 'text', text }], structuredContent: { rows } };
    },
  );

  server.registerTool(
    'get_risk',
    {
      description:
        '住所または緯度経度を基点に、最寄り町丁目の地震地域危険度（建物倒壊/火災/総合ランク）を取得する。ランクは1=最も安全〜5=最も危険。',
      inputSchema: z
        .object({
          address: z.string().optional().describe('住所（lat/lon未指定時は必須）'),
          lat: z.number().optional().describe('緯度'),
          lon: z.number().optional().describe('経度'),
        })
        .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
          message: 'address か lat/lon のどちらかが必要です',
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ address, lat, lon }) => {
      const center = await resolveCenter(env, address, lat, lon);
      const risk = await queryRiskByLocation(env.DB, center.lat, center.lon);
      if (!risk) {
        return {
          content: [{ type: 'text', text: 'この地点の地震危険度データは見つかりませんでした' }],
          structuredContent: { center, risk: null },
        };
      }
      const text = `${risk.town} の地震危険度: 総合ランク${risk.totalRank} / 建物倒壊ランク${risk.collapseRank} / 火災ランク${risk.fireRank}（ランクは1=最も安全〜5=最も危険、出典: 東京都 第9回調査）`;
      return { content: [{ type: 'text', text }], structuredContent: { center, risk } };
    },
  );

  server.registerTool(
    'get_crime',
    {
      description: '住所または緯度経度を基点に、最寄り町丁目の犯罪認知件数を取得する。',
      inputSchema: z
        .object({
          address: z.string().optional().describe('住所（lat/lon未指定時は必須）'),
          lat: z.number().optional().describe('緯度'),
          lon: z.number().optional().describe('経度'),
        })
        .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
          message: 'address か lat/lon のどちらかが必要です',
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ address, lat, lon }) => {
      const center = await resolveCenter(env, address, lat, lon);
      const crime = await queryCrimeByLocation(env.DB, center.lat, center.lon);
      if (!crime) {
        return {
          content: [{ type: 'text', text: 'この地点の犯罪情報データは見つかりませんでした' }],
          structuredContent: { center, crime: null },
        };
      }
      const text = `${crime.town} の${crime.year}年 犯罪認知件数: ${crime.totalCrimes}件（出典: 警視庁 町丁字別犯罪情報）`;
      return { content: [{ type: 'text', text }], structuredContent: { center, crime } };
    },
  );

  server.registerTool(
    'get_flood',
    {
      description:
        '住所または緯度経度を基点に、周辺500m内の浸水想定リスク（河川浸水の最大浸水深メートル）を取得する。0の場合は該当リスクなし。',
      inputSchema: z
        .object({
          address: z.string().optional().describe('住所（lat/lon未指定時は必須）'),
          lat: z.number().optional().describe('緯度'),
          lon: z.number().optional().describe('経度'),
        })
        .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
          message: 'address か lat/lon のどちらかが必要です',
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ address, lat, lon }) => {
      const center = await resolveCenter(env, address, lat, lon);
      const flood = await loadNearbyFlood(env.RAW_BUCKET, center.lat, center.lon);
      if (!flood) {
        return {
          content: [{ type: 'text', text: 'この地点の浸水想定データは見つかりませんでした' }],
          structuredContent: { center, flood: null },
        };
      }
      const river = flood.riverMax > 0 ? `河川浸水想定最大 ${flood.riverMax.toFixed(1)}m` : '河川浸水想定なし';
      const text = `${river}（周辺500m内の最大値、出典: 東京都建設局 神田川流域浸水予想区域図）`;
      return { content: [{ type: 'text', text }], structuredContent: { center, flood } };
    },
  );

  server.registerTool(
    'get_demographics',
    {
      description:
        '住所または緯度経度を基点に、最寄り町丁目の人口・年齢構成（0-4歳〜85歳以上の階級別人口）を取得する。',
      inputSchema: z
        .object({
          address: z.string().optional().describe('住所（lat/lon未指定時は必須）'),
          lat: z.number().optional().describe('緯度'),
          lon: z.number().optional().describe('経度'),
        })
        .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
          message: 'address か lat/lon のどちらかが必要です',
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ address, lat, lon }) => {
      const center = await resolveCenter(env, address, lat, lon);
      const d = await queryDemographics(env.DB, center.lat, center.lon);
      if (!d) {
        return {
          content: [{ type: 'text', text: 'この地点の人口データは見つかりませんでした' }],
          structuredContent: { center, demographics: null },
        };
      }
      const child = d.age0_4 + d.age5_9 + d.age10_14;
      const working = d.age15_19 + d.age20_24 + d.age25_29 + d.age30_34 + d.age35_39 + d.age40_44 + d.age45_49 + d.age50_54 + d.age55_59 + d.age60_64;
      const elderly = d.age65_69 + d.age70_74 + d.age75_79 + d.age80_84 + d.age85Plus;
      const pct = (n: number) => (d.totalPop > 0 ? Math.round((n / d.totalPop) * 100) : 0);
      const text = `${d.town}: 総人口${d.totalPop}人。14歳以下${pct(child)}%、15〜64歳${pct(working)}%、65歳以上${pct(elderly)}%（出典: 新宿区 地域・年齢別人口）`;
      return { content: [{ type: 'text', text }], structuredContent: { center, demographics: d } };
    },
  );

  server.registerTool(
    'get_shelters',
    {
      description:
        '住所または緯度経度を基点に、周辺2km内の指定緊急避難場所を災害種別（洪水/崖崩れ/地震/大規模火事）付きで取得する。',
      inputSchema: z
        .object({
          address: z.string().optional().describe('住所（lat/lon未指定時は必須）'),
          lat: z.number().optional().describe('緯度'),
          lon: z.number().optional().describe('経度'),
        })
        .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
          message: 'address か lat/lon のどちらかが必要です',
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ address, lat, lon }) => {
      const center = await resolveCenter(env, address, lat, lon);
      const shelters = await queryEmergencyShelters(env.DB, center.lat, center.lon);
      if (!shelters?.length) {
        return {
          content: [{ type: 'text', text: '周辺に指定緊急避難場所は見つかりませんでした' }],
          structuredContent: { center, shelters: [] },
        };
      }
      const rows = shelters.map((s) => {
        const types = [
          s.flood ? '洪水' : '',
          s.landslide ? '崖崩れ' : '',
          s.earthquake ? '地震' : '',
          s.fire ? '大規模火事' : '',
        ].filter(Boolean).join('・');
        return `${s.name} (${formatDistance(s.distanceM)}, 対応: ${types || '不明'})`;
      });
      return {
        content: [{ type: 'text', text: rows.join('\n') }],
        structuredContent: { center, shelters },
      };
    },
  );

  server.registerTool(
    'get_school_zone',
    {
      description: '住所または緯度経度を基点に、最寄り町丁目の通学区域（小学校）を取得する。',
      inputSchema: z
        .object({
          address: z.string().optional().describe('住所（lat/lon未指定時は必須）'),
          lat: z.number().optional().describe('緯度'),
          lon: z.number().optional().describe('経度'),
        })
        .refine((v) => v.address !== undefined || (v.lat !== undefined && v.lon !== undefined), {
          message: 'address か lat/lon のどちらかが必要です',
        }),
      annotations: { readOnlyHint: true },
    },
    async ({ address, lat, lon }) => {
      const center = await resolveCenter(env, address, lat, lon);
      const school = await querySchoolZone(env.DB, center.lat, center.lon);
      const text = school
        ? `この地点の通学区域（小学校）: ${school}（出典: 新宿区 小学校通学区域情報）`
        : 'この地点の通学区域データは見つかりませんでした';
      return { content: [{ type: 'text', text }], structuredContent: { center, school } };
    },
  );

  return server;
}

import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { queryFacilities, queryRules } from './lib/ask';
import { geocodeAddress } from './lib/geocode';
import { formatDistance } from './lib/distance';
import { CATEGORY_LABELS, Category } from './types';
import type { Env } from './worker';

const CATEGORIES = ['shopping', 'medical', 'transport', 'disaster', 'public', 'education'] as const;

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
      let center = { lat: lat as number, lon: lon as number, displayName: address ?? '' };
      if (address) center = await geocodeAddress(env.DB, address);
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

  return server;
}

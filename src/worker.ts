import { createMcpHandler, hostHeaderValidationResponse } from '@modelcontextprotocol/server';
import { buildMcpServer } from './mcp';
import { collectEvacuation } from './lib/collect';
import { geocodeAddress, reverseGeocode } from './lib/geocode';
import { gatherFacts } from './lib/ask';
import { loadNearbyFlood } from './lib/flood';
import { generateAnswer, generateReview } from './lib/answer';
import { Category, CATEGORY_LABELS } from './types';

export interface AskRequest {
  address: string;
  category?: Category;
  question?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface Env {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  AI: Ai;
  ASSETS: Fetcher;
  COLLECT_TOKEN?: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        // 避難所データ（東京都公式オープンデータ）を毎日収集
        const result = await collectEvacuation(env);
        console.log('cron collect:', JSON.stringify(result));
      })(),
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      const rejected = hostHeaderValidationResponse(request, [url.hostname]);
      if (rejected) return rejected;
      return buildMcp(env).fetch(request);
    }
    if (url.pathname === '/api/ask' && request.method === 'POST') {
      return handleAsk(request, env, ctx);
    }
    // 逆ジオコーディング: クリック位置の住所を返す
    if (url.pathname === '/api/reverse' && request.method === 'POST') {
      const body = (await request.json()) as { lat?: number; lon?: number };
      if (typeof body.lat !== 'number' || typeof body.lon !== 'number') {
        return json({ error: 'lat/lon が必要です' }, 400);
      }
      const address = await reverseGeocode(env.DB, body.lat, body.lon);
      return json({ address, lat: body.lat, lon: body.lon });
    }
    // 物件レビューAI: 選択地点の暮らしを総評として自動生成
    if (url.pathname === '/api/review' && request.method === 'POST') {
      return handleReview(request, env, ctx);
    }


    if (url.pathname === '/api/health') {
      return json({ ok: true, ward: '新宿区' });
    }

    // 自前タイル配信（R2から）。OSMタイルサーバーには依存しない
    const tileMatch = url.pathname.match(/^\/tiles\/(\d+)\/(\d+)\/(\d+)\.png$/);
    if (tileMatch) {
      const [, z, x, y] = tileMatch;
      const obj = await env.RAW_BUCKET.get(`tiles/${z}/${x}/${y}.png`);
      if (!obj) return new Response('not found', { status: 404 });
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    // 道路グラフ（A*経路探索用）
    if (url.pathname === '/api/roads') {
      const obj = await env.RAW_BUCKET.get('roads/shinjuku-roads.json');
      if (!obj) return json({ error: '道路データなし' }, 404);
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    // 新宿区の行政境界ポリゴン（地図の対象範囲表示用）
    if (url.pathname === '/api/boundary') {
      const obj = await env.RAW_BUCKET.get('boundary/shinjuku.geojson');
      if (!obj) return json({ error: '境界データなし' }, 404);
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    // 浸水想定区域（洪水レイヤー）
    if (url.pathname === '/api/flood') {
      const obj = await env.RAW_BUCKET.get('flood/shinjuku-flood.json');
      if (!obj) return json({ error: '浸水データなし' }, 404);
      return new Response(obj.body, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    if (url.pathname === '/api/buildings') {
      return json({ error: '建物データは廃止されました。地図上をクリックして物件を選択してください' }, 410);
    }

    if (url.pathname === '/api/collect' && request.method === 'POST') {
      const token = request.headers.get('x-collect-token');
      if (!env.COLLECT_TOKEN || token !== env.COLLECT_TOKEN) {
        return json({ error: 'forbidden' }, 403);
      }
      const result = await collectEvacuation(env);
      return json({ result });
    }

    // 静的アセット
    return env.ASSETS.fetch(request);
  },
};

let mcpHandler: ReturnType<typeof createMcpHandler> | undefined;
function buildMcp(env: Env) {
  if (!mcpHandler) mcpHandler = createMcpHandler(() => buildMcpServer(env));
  return mcpHandler;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

async function handleAsk(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = (await request.json()) as AskRequest & { lat?: number; lon?: number };
    let location;
    if (typeof body.lat === 'number' && typeof body.lon === 'number') {
      location = { lat: body.lat, lon: body.lon, displayName: body.address || '地図上の選択地点' };
    } else {
      if (!body.address || !body.address.trim()) {
        return json({ error: '住所を入力してください' }, 400);
      }
      location = await geocodeAddress(env.DB, body.address.trim());
    }

    const facts = await gatherFacts(env.DB, location.lat, location.lon, await loadNearbyFlood(env.RAW_BUCKET, location.lat, location.lon));
    facts.location = location;

    // AI回答を生成するか（質問がある場合のみ）
    const question = body.question?.trim() || (body.category ? defaultQuestionFor(body.category) : '');
    let answer = '';
    if (question) {
      try {
        answer = await generateAnswer(env, facts, question, body.history);
      } catch (e) {
        answer = `（回答生成に失敗しました: ${(e as Error).message}）`;
      }
    }

    return json({
      answer,
      location,
      facilities: facts.facilities,
      rules: facts.rules,
      risk: facts.risk,
      crime: facts.crime,
      flood: facts.flood,
      demographics: facts.demographics,
      aed: facts.aed,
      toilets: facts.toilets,
      parks: facts.parks,
      emergencyShelters: facts.emergencyShelters,
      schoolZone: facts.schoolZone,
      question,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

function defaultQuestionFor(category: Category | undefined): string {
  const qs: Record<string, string> = {
    shopping: 'この住所の周辺のスーパー・コンビニなどの買い物環境はどうですか？',
    medical: 'この住所の周辺の病院・薬局などの医療環境はどうですか？',
    garbage: 'この住所のごみ出しの曜日と分別ルールを教えてください',
    transport: 'この住所の最寄り駅と交通アクセスはどうですか？',
    disaster: 'この住所の災害リスク（洪水・避難所）はどうですか？',
    public: 'この住所の周辺の図書館・区役所などの公共施設はどうですか？',
    education: 'この住所の周辺の小学校・中学校などの学校はどうですか？',
    childcare: 'この住所の周辺の保育園・幼稚園などの子育て環境はどうですか？',
  };
  return category ? qs[category] : qs.transport;
}

// 物件レビューAI: 選択地点の暮らしを自動総評する
async function handleReview(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  try {
    const body = (await request.json()) as { lat?: number; lon?: number; address?: string };
    let location;
    if (typeof body.lat === 'number' && typeof body.lon === 'number') {
      location = { lat: body.lat, lon: body.lon, displayName: body.address || '地図上の選択地点' };
    } else if (body.address) {
      location = await geocodeAddress(env.DB, body.address);
    } else {
      return json({ error: 'lat/lon または address が必要です' }, 400);
    }
    const facts = await gatherFacts(env.DB, location.lat, location.lon, await loadNearbyFlood(env.RAW_BUCKET, location.lat, location.lon));
    facts.location = location;
    const review = await generateReview(env, facts);
    return json({
      review,
      location,
      facilities: facts.facilities,
      rules: facts.rules,
      risk: facts.risk,
      crime: facts.crime,
      flood: facts.flood,
      demographics: facts.demographics,
      aed: facts.aed,
      toilets: facts.toilets,
      parks: facts.parks,
      emergencyShelters: facts.emergencyShelters,
      schoolZone: facts.schoolZone,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
}

export { Category, CATEGORY_LABELS };

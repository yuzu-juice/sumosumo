import { AnswerFacts } from './ask';
import { CATEGORY_LABELS, Category } from '../types';
import { formatDistance } from './distance';

const MODEL = '@cf/openai/gpt-oss-20b';

// 物件レビューAI: 物件選択時に「この物件の暮らし」を総評として自動生成する
export async function generateReview(env: { AI: Ai }, facts: AnswerFacts): Promise<string> {
  const context = buildContext(facts);
  const prompt = `あなたは、物件に実際に住んだらどうなるかを語る「物件レビュアー」です。東京都新宿区のある地点の暮らしを、与えられた事実だけに基づいてレビューします。

ルール:
- 事実データに書いてある内容だけを使う。事実にないことは書かない。
- 施設名・距離・危険度ランク・犯罪件数を織り込みながら、「ここに住むとどんな生活になるか」を具体的に語る。
- 良い面（駅近・買い物便利など）と、気をつける面（危険度・犯罪件数など）の両方に、1文ずつ触れる。
- 総合スコア・点数・「おすすめ」断定は出さない。
- 箇条書きは使わず、5〜7文の読みやすい文章にする。一人称は使わず、客観的なレビュー文にする。

【事実データ】
${context}

レビュー:`;

  return runAi(env, prompt);
}

export async function generateAnswer(
  env: { AI: Ai },
  facts: AnswerFacts,
  question: string,
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
): Promise<string> {
  // 質問のトピックを判定し、関連データだけを渡す（質問以外のデータには触れさせない）
  const topic = detectTopic(question);
  const relevant = topic ? extractTopicFacts(facts, topic) : buildContext(facts);
  if (!relevant.trim()) return 'この質問に該当するデータが見つかりませんでした。';
  const historyBlock = history?.length
    ? `\n\n【これまでの会話】\n${history.map((m) => `${m.role === 'user' ? '利用者' : 'あなた'}: ${m.content}`).join('\n')}`
    : '';
  const prompt = `あなたは、東京都新宿区の物件について「暮らし」の質問に答える物件レビューアシスタントです。
対話の進め方:
- 与えられた「関連データ」に書いてある内容だけを使って回答する。それ以外の項目（駅・買い物・医療など、関連データに無いもの）には一切触れない。
- 人間らしく・自然な会話で回答する。箇条書きの羅列ではなく、文で説明する。
- 事実にないことは「データ上確認できません」と明記し、推測・断定はしない。
- 総合スコア・点数・ランキングは出さない。
- 距離・施設名・出典は自然に織り込む。
- 3〜5文程度の簡潔な回答。質問のニュアンス（例: 「家族で住む」「夜遅く帰る」）を汲み取る。

質問: ${question}${historyBlock}

【関連データ】
${relevant}

回答:`;

  return runAi(env, prompt);
}

type Topic = 'crime' | 'disaster' | 'shopping' | 'medical' | 'transport' | 'risk';

export function detectTopic(q: string): Topic | null {
  if (/治安|犯罪|安全|怖|事件/.test(q)) return 'crime';
  if (/地震|危険度|倒壊|火災リスク|揺れ/.test(q)) return 'risk';
  if (/洪水|浸水|避難|災害|津波|水害|大雨/.test(q)) return 'disaster';
  if (/買い物|スーパー|コンビニ|買|店/.test(q)) return 'shopping';
  if (/病院|診療|薬局|医療|医者|夜間|救急/.test(q)) return 'medical';
  if (/駅|交通|通勤|電車|バス|徒歩/.test(q)) return 'transport';
  return null;
}

export function extractTopicFacts(facts: AnswerFacts, topic: Topic): string {
  const lines: string[] = [];
  if (topic === 'crime' && facts.crime) {
    lines.push(`犯罪認知件数（${facts.crime.town}）: ${facts.crime.year}年に${facts.crime.totalCrimes}件（出典: 警視庁）`);
  }
  if (topic === 'risk' && facts.risk) {
    lines.push(
      `地震危険度（${facts.risk.town}）: 総合ランク${facts.risk.totalRank}（ランクは1=低い〜5=高い）、建物倒壊ランク${facts.risk.collapseRank}、火災ランク${facts.risk.fireRank}（出典: 東京都 第9回調査）`,
    );
  }
  if (topic === 'disaster') {
    for (const f of facts.facilities.disaster || []) {
      lines.push(`避難所: ${f.name}（${formatDistance(f.distanceM)}）`);
    }
    for (const r of facts.rules) {
      if (r.category === 'disaster') lines.push(`[防災] ${r.title}: ${r.body}`);
    }
  }
  if (topic === 'shopping') {
    for (const f of facts.facilities.shopping || []) lines.push(`買い物: ${f.name}（${formatDistance(f.distanceM)}）`);
  }
  if (topic === 'medical') {
    for (const f of facts.facilities.medical || []) lines.push(`医療: ${f.name}（${formatDistance(f.distanceM)}）`);
  }
  if (topic === 'transport') {
    for (const f of facts.facilities.transport || []) lines.push(`駅: ${f.name}（${formatDistance(f.distanceM)}）`);
  }
  return lines.join('\n');
}

async function runAi(env: { AI: Ai }, prompt: string): Promise<string> {
  const res = await env.AI.run(MODEL, {
    messages: [{ role: 'user', content: prompt }],
  });
  const text = extractText(res);
  if (!text) {
    console.log('AI応答が空。raw=', JSON.stringify(res).slice(0, 500));
    throw new Error('AI応答が得られませんでした');
  }
  return text;
}

// Workers AIの応答形式の違いを吸収する（llama系: response / gpt-oss系: choices[0].message.content）
function extractText(res: unknown): string {
  const r = res as Record<string, unknown>;
  if (typeof r.response === 'string') return r.response;
  const choices = r.choices as Array<{ message?: { content?: string } }> | undefined;
  if (Array.isArray(choices) && choices[0]?.message?.content) {
    return choices[0].message.content;
  }
  return '';
}

export function buildContext(facts: AnswerFacts): string {
  const parts: string[] = [];
  parts.push(`検索地点: ${facts.location.displayName || '指定住所'}（緯度${facts.location.lat}, 経度${facts.location.lon}）`);
  // 危険度・犯罪は冒頭に置く（LLMが重視しやすい）
  if (facts.risk) {
    parts.push(
      `【地震地域危険度（${facts.risk.town}）】建物倒壊危険度ランク${facts.risk.collapseRank}、火災危険度ランク${facts.risk.fireRank}、総合危険度ランク${facts.risk.totalRank}（ランクは1=低い〜5=高い。出典: 東京都都市整備局 地震に関する地域危険度測定調査 第9回）`,
    );
  }
  if (facts.crime) {
    parts.push(
      `【犯罪認知件数（${facts.crime.town}）】${facts.crime.year}年の総認知件数 ${facts.crime.totalCrimes}件（出典: 警視庁 町丁字別犯罪情報）`,
    );
  }
  const labels = {
    shopping: '買い物',
    medical: '医療',
    transport: '交通',
    disaster: '災害',
  } as const;
  for (const key of ['shopping', 'medical', 'transport', 'disaster'] as const) {
    const facs = facts.facilities[key];
    if (!facs?.length) continue;
    parts.push(`【${labels[key]}】`);
    for (const f of facs) {
      parts.push(`- ${f.name}: 約${formatDistance(f.distanceM)}（出典: ${f.source}, 更新${f.updatedAt}）`);
    }
  }
  if (facts.rules.length) {
    parts.push('【区のルール】');
    for (const r of facts.rules) {
      parts.push(`- [${CATEGORY_LABELS[r.category as Category] ?? r.category}] ${r.title}: ${r.body}（出典: ${r.sourceUrl}, 更新${r.updatedAt}）`);
    }
  }
  return parts.join('\n');
}

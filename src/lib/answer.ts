import { AnswerFacts } from './ask';
import { CATEGORY_LABELS, Category } from '../types';
import { formatDistance } from './distance';

const MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

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
- **緯度・経度の数値は絶対に回答に含めない**。施設名・距離・ランクなどの数値だけを使う。
- **危険度ランクの解釈**: ランク1〜2は「低い・安全側」、3は「やや高め」、4〜5は「高い」。数値が小さいほど安全。ランク1や2を「高い・危険」と解釈してはならない。
- 距離・施設名・出典は自然に織り込む。
- 3〜5文程度の簡潔な回答。質問のニュアンス（例: 「家族で住む」「夜遅く帰る」）を汲み取る。

質問: ${question}${historyBlock}

【関連データ】
${relevant}

回答:`;

  return runAi(env, prompt);
}

type Topic = 'crime' | 'disaster' | 'shopping' | 'medical' | 'transport' | 'risk' | 'public' | 'education' | 'childcare';

export function detectTopic(q: string): Topic | null {
  if (/治安|犯罪|安全|怖|事件/.test(q)) return 'crime';
  // 避難・避難所は洪水・地震より優先（防災リスク全体を扱う）
  if (/避難|避難所|避難場所|災害時/.test(q)) return 'disaster';
  if (/地震|危険度|倒壊|火災リスク|揺れ/.test(q)) return 'risk';
  if (/洪水|浸水|災害|津波|水害|大雨/.test(q)) return 'disaster';
  if (/人口|年齢|住みやすさ|世代|家族構成/.test(q)) return 'public';
  if (/図書館|公共|区役所|役所|公園|体育館|プール/.test(q)) return 'public';
  if (/保育園|幼稚園|子育て|学童|児童館/.test(q)) return 'childcare';
  if (/学校|小学校|中学校|高校|通学/.test(q)) return 'education';
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
      `地震危険度（${facts.risk.town}）: 総合ランク${facts.risk.totalRank}、建物倒壊ランク${facts.risk.collapseRank}、火災ランク${facts.risk.fireRank}。※ランクは1=最も安全〜5=最も危険。1〜2は安全側・低い、3はやや高め、4〜5は高い。数値が小さいほど安全。（出典: 東京都 第9回調査）`,
    );
  }
  if (topic === 'disaster') {
    if (facts.flood && facts.flood.riverMax > 0) {
      lines.push(`浸水想定（選択地点周辺500mの最大値）: 河川浸水想定最大${facts.flood.riverMax.toFixed(1)}m（出典: 東京都建設局 神田川流域浸水予想区域図）`);
    }
    for (const f of facts.facilities.disaster || []) {
      lines.push(`避難所: ${f.name}（${formatDistance(f.distanceM)}）`);
    }
    for (const s of facts.emergencyShelters || []) {
      const types = [
        s.flood ? '洪水' : '',
        s.landslide ? '崖崩れ' : '',
        s.earthquake ? '地震' : '',
        s.fire ? '大規模火事' : '',
      ].filter(Boolean).join('・');
      lines.push(`指定緊急避難場所: ${s.name}（${formatDistance(s.distanceM)}, 対応: ${types || '不明'}）`);
    }
    for (const r of facts.rules) {
      if (r.category === 'disaster') lines.push(`[防災] ${r.title}: ${r.body}`);
    }
  }
  if (topic === 'shopping') {
    for (const f of facts.facilities.shopping || []) lines.push(`買い物: ${f.name}（${formatDistance(f.distanceM)}）`);
  }
  if (topic === 'medical') {
    for (const f of facts.facilities.medical || []) {
      const dept = f.department ? `（診療科目: ${f.department}）` : '';
      lines.push(`医療: ${f.name}${dept}（${formatDistance(f.distanceM)}）`);
    }
  }
  if (topic === 'transport') {
    for (const f of facts.facilities.transport || []) lines.push(`駅: ${f.name}（${formatDistance(f.distanceM)}）`);
  }
  if (topic === 'public') {
    if (facts.demographics) {
      const d = facts.demographics;
      const child = d.age0_4 + d.age5_9 + d.age10_14;
      const working = d.age15_19 + d.age20_24 + d.age25_29 + d.age30_34 + d.age35_39 + d.age40_44 + d.age45_49 + d.age50_54 + d.age55_59 + d.age60_64;
      const elderly = d.age65_69 + d.age70_74 + d.age75_79 + d.age80_84 + d.age85Plus;
      const pct = (n: number) => (d.totalPop > 0 ? Math.round((n / d.totalPop) * 100) : 0);
      lines.push(`${d.town}: 総人口${d.totalPop}人、14歳以下${pct(child)}%、15〜64歳${pct(working)}%、65歳以上${pct(elderly)}%、若年層(20〜34歳)${pct(d.age20_24 + d.age25_29 + d.age30_34)}%（出典: 新宿区 地域・年齢別人口）`);
    }
    for (const f of facts.facilities.public || []) lines.push(`公共施設: ${f.name}（${formatDistance(f.distanceM)}）`);
    if (facts.aed?.length) lines.push(`AED: ${facts.aed[0].name}（${formatDistance(facts.aed[0].distanceM)}）`);
    if (facts.toilets?.length) lines.push(`公衆トイレ: ${facts.toilets[0].name}（${formatDistance(facts.toilets[0].distanceM)}）`);
    if (facts.parks?.length) lines.push(`公園: ${facts.parks[0].name}（${formatDistance(facts.parks[0].distanceM)}）`);
  }
  if (topic === 'education') {
    for (const f of facts.facilities.education || []) lines.push(`学校: ${f.name}（${formatDistance(f.distanceM)}）`);
    if (facts.schoolZone) lines.push(`この地点の通学区域: ${facts.schoolZone}（出典: 新宿区 小学校通学区域）`);
  }
  if (topic === 'childcare') {
    for (const f of facts.facilities.childcare || []) lines.push(`子育て施設: ${f.name}（${formatDistance(f.distanceM)}）`);
  }
  return lines.join('\n');
}

async function runAi(env: { AI: Ai }, prompt: string): Promise<string> {
  const res = await env.AI.run(MODEL, {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 600,
  });
  const text = extractText(res);
  if (!text) {
    throw new Error(`AI応答が得られませんでした: ${JSON.stringify(res).slice(0, 300)}`);
  }
  return text;
}

// Workers AIの応答形式の違いを吸収する（llama系: response / gpt-oss系: choices[0].message.content）
function extractText(res: unknown): string {
  const r = res as Record<string, unknown>;
  if (typeof r.response === 'string') return r.response;
  const choices = r.choices as Array<{ message?: { content?: string | null } }> | undefined;
  if (Array.isArray(choices) && typeof choices[0]?.message?.content === 'string') {
    return choices[0].message.content;
  }
  return '';
}

export function buildContext(facts: AnswerFacts): string {
  const parts: string[] = [];
  parts.push(`検索地点: ${facts.location.displayName || '指定住所'}`);
  // 危険度・犯罪は冒頭に置く（LLMが重視しやすい）
  if (facts.risk) {
    parts.push(
      `【地震地域危険度（${facts.risk.town}）】建物倒壊危険度ランク${facts.risk.collapseRank}、火災危険度ランク${facts.risk.fireRank}、総合危険度ランク${facts.risk.totalRank}。※重要: このランクは1が最も安全（低い）で5が最も危険（高い）。1〜2は「低い・安全側」、3は「やや高め」、4〜5は「高い」を意味する。数値が小さいほど安全。（出典: 東京都都市整備局 地震に関する地域危険度測定調査 第9回）`,
    );
  }
  if (facts.crime) {
    parts.push(
      `【犯罪認知件数（${facts.crime.town}）】${facts.crime.year}年の総認知件数 ${facts.crime.totalCrimes}件（出典: 警視庁 町丁字別犯罪情報）`,
    );
  }
  if (facts.flood) {
    const river = facts.flood.riverMax > 0 ? `河川浸水想定最大${facts.flood.riverMax.toFixed(1)}m` : '河川浸水想定なし';
    parts.push(
      `【浸水想定（選択地点周辺500mの最大値）】${river}（出典: 東京都建設局 神田川流域浸水予想区域図）`,
    );
  }
  // 町丁目プロフィール（人口構成・学区・生活快適データ）
  if (facts.demographics) {
    const d = facts.demographics;
    const child = d.age0_4 + d.age5_9 + d.age10_14; // 14歳以下
    const working = d.age15_19 + d.age20_24 + d.age25_29 + d.age30_34 + d.age35_39 + d.age40_44 + d.age45_49 + d.age50_54 + d.age55_59 + d.age60_64; // 15-64歳
    const elderly = d.age65_69 + d.age70_74 + d.age75_79 + d.age80_84 + d.age85Plus; // 65歳以上
    const pct = (n: number) => (d.totalPop > 0 ? Math.round((n / d.totalPop) * 100) : 0);
    parts.push(
      `【町丁目人口（${d.town}）】総人口${d.totalPop}人（世帯数${d.households ?? '不明'}）。14歳以下${child}人(${pct(child)}%)、15〜64歳${working}人(${pct(working)}%)、65歳以上${elderly}人(${pct(elderly)}%)。若年層(20〜34歳)は${pct(d.age20_24 + d.age25_29 + d.age30_34)}%。（出典: 新宿区 地域・年齢別人口）`,
    );
  }
  if (facts.schoolZone) {
    parts.push(`【通学区域】この地点は「${facts.schoolZone}」の学区です。（出典: 新宿区 小学校通学区域）`);
  }
  if (facts.aed?.length) {
    parts.push(`【AED】最寄りは「${facts.aed[0].name}」まで約${Math.round(facts.aed[0].distanceM)}m。（出典: 新宿区 AED設置個所一覧）`);
  }
  if (facts.toilets?.length) {
    const t = facts.toilets[0];
    parts.push(`【公衆トイレ】最寄りは「${t.name}」まで約${Math.round(t.distanceM)}m。（出典: 新宿区 公衆トイレ一覧）`);
  }
  if (facts.parks?.length) {
    const p = facts.parks[0];
    parts.push(`【公園】最寄りは「${p.name}」まで約${Math.round(p.distanceM)}m。（出典: 東京都 都市公園一覧）`);
  }
  if (facts.emergencyShelters?.length) {
    const s = facts.emergencyShelters[0];
    const types = [
      s.flood ? '洪水' : '',
      s.landslide ? '崖崩れ' : '',
      s.earthquake ? '地震' : '',
      s.fire ? '大規模火事' : '',
    ].filter(Boolean).join('・');
    parts.push(`【指定緊急避難場所】最寄りは「${s.name}」まで約${Math.round(s.distanceM)}m（対応: ${types || '不明'}）。（出典: 新宿区 指定緊急避難場所）`);
  }
  const labels = {
    shopping: '買い物',
    medical: '医療',
    transport: '交通',
    disaster: '災害',
    public: '公共施設',
    education: '学校',
    childcare: '子育て',
  } as const;
  for (const key of ['shopping', 'medical', 'transport', 'disaster', 'public', 'education', 'childcare'] as const) {
    const facs = facts.facilities[key];
    if (!facs?.length) continue;
    parts.push(`【${labels[key]}】`);
    for (const f of facs) {
      const dept = key === 'medical' && f.department ? `（診療科目: ${f.department}）` : '';
      parts.push(`- ${f.name}${dept}: 約${formatDistance(f.distanceM)}（出典: ${f.source}, 更新${f.updatedAt}）`);
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

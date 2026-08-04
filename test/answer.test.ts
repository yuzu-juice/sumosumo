import { describe, it, expect } from 'vitest';
import { buildContext, detectTopic, extractTopicFacts } from '../src/lib/answer';
import { AnswerFacts } from '../src/lib/ask';

const facts: AnswerFacts = {
  location: { lat: 35.6909, lon: 139.7003, displayName: '東京都新宿区新宿' },
  facilities: {
    shopping: [
      {
        id: 1,
        category: 'shopping',
        name: 'テストスーパー',
        lat: 35.691,
        lon: 139.7003,
        address: '',
        distanceM: 120,
        source: 'OpenStreetMap',
        updatedAt: '2026-08-01',
      },
    ],
    medical: [],
    transport: [],
    disaster: [],
    public: [],
    education: [],
    childcare: [],
  },
  rules: [
    {
      id: 1,
      category: 'disaster',
      ward: '新宿区',
      title: '洪水ハザードマップ',
      body: '想定最大規模降雨による浸水想定区域を掲載。',
      source: '新宿区',
      sourceUrl: 'https://example.com/flood',
      updatedAt: '2026-03-25',
    },
  ],
  demographics: {
    town: '歌舞伎町1丁目',
    lat: 35.6938,
    lon: 139.7034,
    totalPop: 156,
    households: 90,
    age0_4: 5, age5_9: 4, age10_14: 3, age15_19: 8,
    age20_24: 12, age25_29: 11, age30_34: 10, age35_39: 9,
    age40_44: 8, age45_49: 7, age50_54: 6, age55_59: 5,
    age60_64: 6, age65_69: 8, age70_74: 9, age75_79: 10,
    age80_84: 15, age85Plus: 20,
  },
  aed: [{ name: '区役所', lat: 35.6938, lon: 139.7034, distanceM: 10 }],
  emergencyShelters: [
    { name: '新宿御苑', lat: 35.6865, lon: 139.7149, distanceM: 688, flood: false, landslide: false, stormSurge: false, earthquake: true, fire: false, capacity: null },
  ],
  schoolZone: '花園',
};

describe('buildContext', () => {
  it('施設名・距離・出典が含まれる', () => {
    const ctx = buildContext(facts);
    expect(ctx).toContain('テストスーパー');
    expect(ctx).toContain('120m');
    expect(ctx).toContain('OpenStreetMap');
  });

  it('ルールのタイトルと出典URLが含まれる', () => {
    const ctx = buildContext(facts);
    expect(ctx).toContain('洪水ハザードマップ');
    expect(ctx).toContain('https://example.com/flood');
  });

  it('検索地点が含まれる', () => {
    expect(buildContext(facts)).toContain('東京都新宿区新宿');
  });

  it('地震危険度・犯罪情報が含まれる', () => {
    const factsWithRisk: AnswerFacts = {
      ...facts,
      risk: { town: '西新宿1丁目', collapseRank: 2, fireRank: 3, totalRank: 3 },
      crime: { town: '西新宿1丁目', totalCrimes: 100, year: 2024 },
    };
    const ctx = buildContext(factsWithRisk);
    expect(ctx).toContain('地震地域危険度');
    expect(ctx).toContain('総合危険度ランク3');
    expect(ctx).toContain('犯罪認知件数');
    expect(ctx).toContain('100件');
  });
});

describe('detectTopic', () => {
  it('治安・犯罪の質問をcrimeと判定', () => {
    expect(detectTopic('この辺りの治安は？犯罪件数は？')).toBe('crime');
  });
  it('地震の質問をriskと判定', () => {
    expect(detectTopic('地震の危険度は？')).toBe('risk');
  });
  it('洪水・避難の質問をdisasterと判定', () => {
    expect(detectTopic('洪水のリスクと避難所は？')).toBe('disaster');
  });
  it('駅の質問をtransportと判定', () => {
    expect(detectTopic('最寄り駅はどこ？')).toBe('transport');
  });
  it('図書館の質問をpublicと判定', () => {
    expect(detectTopic('図書館は近くにある？')).toBe('public');
  });
  it('保育園の質問をchildcareと判定', () => {
    expect(detectTopic('この辺りの保育園は？')).toBe('childcare');
  });
  it('学校の質問をeducationと判定', () => {
    expect(detectTopic('近くの小学校は？')).toBe('education');
  });
  it('無関係な質問はnull', () => {
    expect(detectTopic('今日の天気は？')).toBeNull();
  });
});

describe('extractTopicFacts', () => {
  const factsWithData: AnswerFacts = {
    ...facts,
    risk: { town: '歌舞伎町1丁目', collapseRank: 2, fireRank: 1, totalRank: 1 },
    crime: { town: '歌舞伎町1丁目', totalCrimes: 839, year: 2024 },
  };
  it('crimeトピックは犯罪件数を含む', () => {
    const out = extractTopicFacts(factsWithData, 'crime');
    expect(out).toContain('839');
    expect(out).toContain('警視庁');
  });
  it('riskトピックは危険度ランクを含む', () => {
    const out = extractTopicFacts(factsWithData, 'risk');
    expect(out).toContain('総合ランク1');
  });
  it('disasterトピックは指定緊急避難場所と災害種別を含む', () => {
    const out = extractTopicFacts(factsWithData, 'disaster');
    expect(out).toContain('新宿御苑');
    expect(out).toContain('地震');
  });
  it('educationトピックは通学区域を含む', () => {
    const out = extractTopicFacts(factsWithData, 'education');
    expect(out).toContain('花園');
  });
  it('publicトピックは人口構成を含む', () => {
    const out = extractTopicFacts(factsWithData, 'public');
    expect(out).toContain('歌舞伎町1丁目');
    expect(out).toContain('総人口156');
  });
});

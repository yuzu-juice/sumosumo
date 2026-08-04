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
});

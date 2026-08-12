---
marp: true
theme: default
paginate: false
size: 16:9
style: |
  section {
    font-family: "Zen Maru Gothic", "Hiragino Kaku Gothic ProN", sans-serif;
    color: #1c1914;
    padding: 2.2rem 3rem;
  }
  h1 {
    font-size: 2.6rem;
    color: #1c1914;
    line-height: 1.3;
  }
  h2 {
    font-size: 1.5rem;
    color: #c53a1f;
    border-left: 6px solid #c53a1f;
    padding-left: 0.7rem;
    margin-bottom: 1.4rem;
  }
  .accent { color: #c53a1f; }
  .muted { color: #6b6457; font-size: 1rem; }
  ul { font-size: 1.15rem; line-height: 1.9; }
  li { margin-bottom: 0.3rem; }
  strong { color: #1c1914; }
  .center { text-align: center; }
  .big { font-size: 1.9rem; font-weight: 700; line-height: 1.5; }
  .tagline { color: #6b6457; font-size: 1.05rem; margin-top: 0.4rem; }
  blockquote {
    border-left: 4px solid #c53a1f;
    margin: 1rem 0;
    padding: 0.5rem 1rem;
    background: #f5f1e8;
    font-size: 1.05rem;
  }
  footer {
    font-size: 0.75rem;
    color: #a8a294;
  }
---

# sumosumo

### 物件選びを「暮らしの選択」に変える

<div class="tagline">新宿区 × オープンデータ × AI — 東京都オープンデータハッカソン2026</div>

---

## 不動産サイトに載っていない、本当に知りたいこと

物件を選ぶとき、不動産サイトで見られるのは **家賃と間取り** だけ。

でも、実際に住むと決めるのは…

- この街に **誰が住んでいるのか**
- **治安・地震・浸水** のリスクは？
- **保育園・学校・病院** は近い？
- 買い物帰りに **坂道** はきつくない？

<div class="muted">こうした「暮らしの情報」は、どこの不動産サイトにも載っていません。</div>

---

## クリック1つで、町丁目の暮らしが見える

<div class="big">地図で物件を選ぶ → <span class="accent">「この町丁目の人々」</span>が浮かび上がる</div>

- **年齢構成** — 20〜30代が◯% / 65歳以上◯%
- **AIレビュー** — 治安・地震・買い物・子育てを根拠付きで
- **チャット** — 「治安は？」と聞けば犯罪件数まで回答
- **学区・AED・公園・避難所** — 住む前の不安を全て可視化

<div class="tagline">［ここでライブデモ：クリック → プロフィール → レビュー → 質問］</div>

---

## 全部、公式オープンデータ。出典付き。

<div class="big">事実だけを、<span class="accent">確認できる形で</span></div>

| データ | 提供元 |
|---|---|
| 地域・年齢別人口 / 子育て施設 | 新宿区 |
| 地震危険度 / 避難所 | 東京都 |
| 浸水想定区域 / AED / 公園 / 学区 | 新宿区・東京都 |

- **総合スコアは出さない** — 押し付けず、判断材料を提供
- **出典と更新日を常に表示** — 信頼できる情報だけ
- 実行時に外部APIに依存しない、**完全独立動作**

---

## 物件選びを「間取りの比較」から「暮らしの選択」へ

<div class="center">
<div class="big">sumosumo</div>
<div class="tagline">ご清聴ありがとうございました</div>
<div style="margin-top:1rem" class="muted">https://odh.tokyo-odh-165-233.workers.dev</div>
</div>

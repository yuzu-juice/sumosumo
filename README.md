# sumosumo（すもすも）

**物件住所を基点に、暮らしの事実をオープンデータから根拠付きで答える不動産AI。**

普通の不動産サイトに載っていない「込み入ったこと」— 洪水リスクの確認方法、避難所への距離、夜間診療、最寄り駅、買い物環境、子育て環境 — を、東京都・新宿区の公式オープンデータから、出典と更新日付きで提示します。**総合スコアは出しません。事実のみ**を提示します。

東京都オープンデータハッカソン2026への提出作品。Cloudflare完結（Workers + D1 + R2 + Cron + Workers AI）。

---

## 特徴

- **物件レビューAI**: 地図で物件を選ぶと、AIがその地点の暮らしをオープンデータ根拠で自動レビュー
- **対話型質問応答**: 会話履歴を保持したマルチターンで質問に回答（Workers AI）
- **逆ジオコーディング**: クリック位置から町丁目住所を特定（外部API非依存）
- **住所→緯度経度**: D1の住所辞書（新宿区公式データ由来）で解決
- **周辺施設検索**: 買い物・医療・交通・公共施設・学校・子育て・避難所を徒歩圏内で表示（D1のみ参照）
- **町丁目プロフィール**: 年齢構成人口・世帯数・通学区域・AED・公園を物件地点ごとに表示
- **徒歩時間ベースの距離制限**: カテゴリごとの徒歩圏（例: 避難所=徒歩15分、駅=徒歩20分）で意味のある施設のみ表示
- **地図UI**: 全画面マップ。クリックでピンを配置し、ドラッグで位置を微調整
- **浸水レイヤー**: 河川浸水想定区域をなめらかな輪郭で表示
- **A*経路探索**: 選択物件から施設までの道路網上の最短経路を描画
- **自前地図タイル**: 新宿区のタイルをR2に収集し自前配信
- **MCP**: `/mcp` でD1データを読むMCPサーバーを公開
- **実行時の外部API依存ゼロ**: アプリ実行中はD1/R2のみ参照

## 利用オープンデータ

> **件数制限について**: 作品で利用できるオープンデータの個数に公式の上限はありません。募集要項の提出フォーム「オープンデータの利用状況」欄には**代表的なデータを最大10件まで**記載します（[募集要項](https://odhackathon.metro.tokyo.lg.jp/recruitment/)）。下表は主な利用データです。

| # | データ | 提供元 | URL |
|---|---|---|---|
| 1 | 新宿区 医療機関一覧（診療科目付き） | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399984.csv |
| 2 | 新宿区 公共施設一覧 | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399965.csv |
| 3 | 新宿区 教育機関一覧 | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399985.csv |
| 4 | 新宿区 子育て施設一覧 | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399969.csv |
| 5 | 新宿区 地域・年齢別人口 | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399968.csv |
| 6 | 新宿区 指定緊急避難場所一覧 | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399967.csv |
| 7 | 新宿区 AED設置個所一覧 | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399971.csv |
| 8 | 新宿区 小学校通学区域情報 | 新宿区 | https://www.city.shinjuku.lg.jp/content/000399976.csv |
| 9 | 東京都 都市公園・都立公園一覧 | 東京都 | https://www.opendata.metro.tokyo.lg.jp/shinjyuku/131041_shinjukuku_toshitoritukouen.csv |
| 10 | OpenStreetMap 施設・道路・建物データ | OpenStreetMap | https://www.openstreetmap.org/copyright |

補助データ（避難所・浸水・公衆トイレ・行政境界など）も利用しています:
- 東京都防災マップ 避難所: https://www.opendata.metro.tokyo.lg.jp/soumu/130001_evacuation_center.csv
- 神田川流域浸水予想区域図: https://www.opendata.metro.tokyo.lg.jp/kensetsu/R3/shinsui_kandagawa.csv
- 新宿区 公衆トイレ一覧: https://www.city.shinjuku.lg.jp/content/000399974.csv
- 新宿区 行政境界（OpenStreetMap）

浸水想定区域データは、東京都の「浸水予想区域図」を利用しています。このデータは**川からの溢水（外水氾濫）と下水道の能力超過による窪地の浸水（内水氾濫）の両方**を含む統合浸水深です（東京都公式notesより）。

## アーキテクチャ

```
[ユーザー] → 静的アセット（public/） + /api/ask
                    │
         Worker（src/worker.ts）
           ├─ /api/ask  ── 住所→座標(D1住所辞書) → D1検索 → Workers AI回答
           ├─ /mcp      ── MCPサーバー（geocode/search_facilities/get_rules）
           ├─ /api/collect（token保護）─ 避難所データのCron収集
           └─ scheduled ── 毎日3:00 に避難所データ更新
                    │
              D1（facilities / rules / address_dict）
              R2（収集データのアーカイブ）
```

**注意**: Overpass API は Cloudflare Workers からのアクセスを 406 でブロックするため、OSM施設データの収集はローカルで `npm run collect:osm` を実行します。

## セットアップ

```bash
npm install
npx wrangler login
npx wrangler d1 create odh-db        # D1作成（初回のみ）
npx wrangler r2 bucket create odh-raw  # R2作成（初回のみ、既存なら不要）
```

`wrangler.jsonc` の `d1_databases[0].database_id` を作成結果に合わせる。

## データ投入（更新手順）

| データ | コマンド | 頻度 |
|---|---|---|
| スキーマ | `npm run db:migrate` | 初回・スキーマ変更時 |
| 区ルール（ごみ・防災・医療） | `npm run db:seed` | 手動（ルール更新時） |
| 新宿区公式（医療/公共/教育/子育て） | `npm run collect:official` | 手動 |
| OSM施設（駅・店舗・病院） | `npm run collect:osm` | 手動（週次推奨） |
| 道路ネットワーク（A*経路） | `npm run collect:roads` | 手動 |
| 地図タイル（自前配信） | `npm run collect:tiles` | 手動 |
| 浸水想定区域（洪水レイヤー） | `npm run collect:flood` | 手動 |
| 町丁目プロフィール（人口/AED/公園/避難場所/学区） | `npm run collect:profile` | 手動 |
| 住所辞書 | `npm run build:geodict` | 公式データ更新時 |
| 避難所（東京都） | `npm run collect:disaster` | 毎日3:00 Cron（自動） |

`collect:disaster` は `COLLECT_TOKEN` 環境変数にトークンを設定してから、ワーカーにシークレットを登録する:
```bash
echo "<トークン>" | npx wrangler secret put COLLECT_TOKEN
```

## 開発

```bash
npm run dev        # wrangler dev（D1/AIはリモート参照）
npm run test       # vitest（31テスト）
npm run typecheck  # TypeScript型チェック
```

## デプロイ

```bash
npm run deploy     # 型チェック + クライアントビルド + wrangler deploy
```

Cron Trigger（毎日3:00）は `wrangler.jsonc` の `triggers.crons` で定義済み。

## CI（スライドビルド）

GitHub Actions（`.github/workflows/ci.yml`）で、push/PRのたびにスライドHTMLを自動ビルドし、5枚以上生成されるか検証します。シークレット設定は不要です。

スライドの再生成はローカルでも可能: `npm run build:slides`

## MCP

MCPクライアント（Claude Desktop等）から接続する場合:

```json
{
  "mcpServers": {
    "odh": {
      "type": "http",
      "url": "https://odh.tokyo-odh-165-233.workers.dev/mcp"
    }
  }
}
```

利用可能なツール:
- `geocode` — 住所→緯度経度
- `search_facilities` — 周辺施設を距離順に検索（7カテゴリ対応）
- `get_rules` — 新宿区の生活ルール（ごみ・災害・医療）
- `get_risk` — 最寄り町丁目の地震地域危険度ランク
- `get_crime` — 最寄り町丁目の犯罪認知件数
- `get_flood` — 周辺の浸水想定リスク（河川）
- `get_demographics` — 最寄り町丁目の人口・年齢構成
- `get_shelters` — 周辺の指定緊急避難場所（災害種別付き）
- `get_school_zone` — 最寄り町丁目の通学区域（小学校）

## テスト

- `test/distance.test.ts` — ハーバサイン距離計算・表示形式
- `test/answer.test.ts` — AI回答コンテキスト生成（事実の包含）
- `test/flood.test.ts` — 浸水データ収集・フィルタロジック
- `test/geocode.test.ts` — 住所→町丁目マッチング
- `test/router.test.ts` — A*最短経路・孤立成分対策

## ディレクトリ構成

```
src/
  worker.ts            # メインWorker（API + MCP + Cron + アセット）
  types.ts             # 共有型（カテゴリ定義）
  mcp.ts               # MCPサーバー定義
  lib/
    collect.ts         # 避難所データ収集（Cron）
    geocode.ts         # 住所→座標（D1住所辞書）
    ask.ts             # D1検索・徒歩圏距離計算
    answer.ts          # Workers AI回答生成（トピック判定含む）
  client/main.ts       # フロントエンド（esbuildでpublic/app.jsへ）
public/                # 静的アセット
migrations/            # D1マイグレーション + シード
scripts/               # データ収集・住所辞書構築スクリプト
test/                  # vitest
docs/pitch/            # ピッチ用スライド（Marp, 2分・5枚）
```

## ピッチ資料

- スライド: `docs/pitch/slides.html`（ブラウザで開いて全画面・矢印キーで送り）
- ソース: `docs/pitch/slides.md`（Marp形式）
- 台本: 2分・1人のデモ台本はスライド本文に即して構成済み

再生成: `cd docs/pitch && npx -y @marp-team/marp-cli slides.md -o slides.html`
PDF化: `slides.html` をブラウザで開き、印刷→PDF保存（環境にChromeが必要）

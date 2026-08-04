-- 0002_seed_rules.sql
-- 新宿区のルール参照データ（出典付き）。2026-08-03 確認時点

INSERT OR REPLACE INTO rules (category, ward, title, body, source, source_url, updated_at) VALUES
('disaster', '新宿区', '洪水ハザードマップ', '想定最大規模降雨（総雨量690mm・時間最大雨量153mm）による浸水想定区域を掲載。ハザードマップは危機管理課・防災センター・特別出張所等で配布。', '新宿区 洪水ハザードマップ', 'https://www.city.shinjuku.lg.jp/anzen/file03_00016.html', '2026-03-25'),
('disaster', '新宿区', '水害時の避難', '水害時の避難行動判定フローと「知っておくべき5つのポイント」を掲載。水害時の避難情報は区の防災メール等で確認。', '新宿区 水害時の避難', 'https://www.city.shinjuku.lg.jp/anzen/kikikanri01_002212.html', '2026-03-25'),
('disaster', '新宿区', '避難場所（広域）・避難所', '地震発生時の避難場所（広域）は大きな公園や広場。避難所は災害発生後に開設される。地域別防災マップで各自確認。', '新宿区 あなたのまちの避難場所（広域）・避難所', 'https://www.city.shinjuku.lg.jp/anzen/file03_00022.html', '2026-02-16'),
('medical', '新宿区', '休日・夜間救急', '休日・夜間の急病時は、新宿区の休日急病診療所や近隣の救急医療機関を確認。急を要する場合は迷わず119番。', '新宿区 健康・医療・衛生', 'https://www.city.shinjuku.lg.jp/kenko/', '2025-04-01');

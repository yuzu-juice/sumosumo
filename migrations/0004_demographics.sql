-- 0004_demographics.sql
-- 町丁目プロフィール用の追加データテーブル

-- 町丁目別の年齢構成人口（新宿区 地域・年齢別人口）
CREATE TABLE IF NOT EXISTS demographics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  town TEXT NOT NULL UNIQUE,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  total_pop INTEGER NOT NULL,
  households INTEGER,
  -- 年齢階級（5歳刻み）の人口、男女合計
  age_0_4 INTEGER NOT NULL DEFAULT 0,
  age_5_9 INTEGER NOT NULL DEFAULT 0,
  age_10_14 INTEGER NOT NULL DEFAULT 0,
  age_15_19 INTEGER NOT NULL DEFAULT 0,
  age_20_24 INTEGER NOT NULL DEFAULT 0,
  age_25_29 INTEGER NOT NULL DEFAULT 0,
  age_30_34 INTEGER NOT NULL DEFAULT 0,
  age_35_39 INTEGER NOT NULL DEFAULT 0,
  age_40_44 INTEGER NOT NULL DEFAULT 0,
  age_45_49 INTEGER NOT NULL DEFAULT 0,
  age_50_54 INTEGER NOT NULL DEFAULT 0,
  age_55_59 INTEGER NOT NULL DEFAULT 0,
  age_60_64 INTEGER NOT NULL DEFAULT 0,
  age_65_69 INTEGER NOT NULL DEFAULT 0,
  age_70_74 INTEGER NOT NULL DEFAULT 0,
  age_75_79 INTEGER NOT NULL DEFAULT 0,
  age_80_84 INTEGER NOT NULL DEFAULT 0,
  age_85_plus INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_demographics_latlon ON demographics(lat, lon);

-- AED設置個所（新宿区）
CREATE TABLE IF NOT EXISTS aed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  address TEXT,
  pediatric INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aed_latlon ON aed(lat, lon);

-- 公衆トイレ（新宿区）
CREATE TABLE IF NOT EXISTS toilets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  address TEXT,
  barrier_free INTEGER NOT NULL DEFAULT 0,
  kids INTEGER NOT NULL DEFAULT 0,
  ostomate INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_toilets_latlon ON toilets(lat, lon);

-- 都市公園・都立公園（東京都）
CREATE TABLE IF NOT EXISTS parks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  area_m2 REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parks_latlon ON parks(lat, lon);

-- 指定緊急避難場所（新宿区、災害種別フラグ付き）
CREATE TABLE IF NOT EXISTS emergency_shelters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  flood INTEGER NOT NULL DEFAULT 0,        -- 洪水
  landslide INTEGER NOT NULL DEFAULT 0,    -- 崖崩れ・土石流
  storm_surge INTEGER NOT NULL DEFAULT 0,  -- 高潮
  earthquake INTEGER NOT NULL DEFAULT 0,   -- 地震
  fire INTEGER NOT NULL DEFAULT 0,         -- 大規模火事
  capacity INTEGER,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emergency_latlon ON emergency_shelters(lat, lon);

-- 小学校通学区域（新宿区、住所リスト）
CREATE TABLE IF NOT EXISTS school_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school TEXT NOT NULL,
  zone_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

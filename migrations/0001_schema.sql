-- 0001_schema.sql
-- 施設・ルール・出典のスキーマ

CREATE TABLE IF NOT EXISTS facilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,             -- shopping | medical | transport | disaster
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  address TEXT,
  source TEXT NOT NULL DEFAULT 'OpenStreetMap',
  updated_at TEXT NOT NULL,
  UNIQUE (category, name, lat, lon)
);

CREATE INDEX IF NOT EXISTS idx_facilities_category ON facilities(category);
CREATE INDEX IF NOT EXISTS idx_facilities_latlon ON facilities(lat, lon);

CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,             -- garbage | disaster | medical | transport | shopping
  ward TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_category ON rules(category);

CREATE TABLE IF NOT EXISTS address_dict (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  town TEXT NOT NULL UNIQUE,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  n_samples INTEGER NOT NULL DEFAULT 1
);

-- 地震地域危険度（東京都都市整備局 第9回調査、町丁目別）
CREATE TABLE IF NOT EXISTS risk_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  town TEXT NOT NULL UNIQUE,
  collapse_rank INTEGER NOT NULL,
  fire_rank INTEGER NOT NULL,
  total_rank INTEGER NOT NULL
);

-- 犯罪認知件数（警視庁 町丁字別犯罪情報、町丁目別）
CREATE TABLE IF NOT EXISTS crime_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  town TEXT NOT NULL UNIQUE,
  total_crimes INTEGER NOT NULL,
  source_year INTEGER NOT NULL
);

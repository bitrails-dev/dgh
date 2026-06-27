PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  date TEXT NOT NULL,
  author TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hospital-news','health-tips','research','events')),
  thumbnail TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  lang TEXT NOT NULL DEFAULT 'ar' CHECK (lang IN ('ar','en')),
  excerpt TEXT,
  excerpt_ar TEXT,
  body TEXT NOT NULL DEFAULT '',
  body_ar TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  specialty TEXT NOT NULL,
  specialty_ar TEXT NOT NULL,
  photo TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  bio_ar TEXT NOT NULL DEFAULT '',
  certified INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  role TEXT,
  role_ar TEXT,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description TEXT NOT NULL,
  description_ar TEXT NOT NULL,
  icon TEXT NOT NULL,
  center_of_excellence INTEGER NOT NULL DEFAULT 0,
  featured INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  description TEXT NOT NULL,
  description_ar TEXT NOT NULL,
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS awards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  body TEXT NOT NULL,
  body_ar TEXT,
  year INTEGER NOT NULL,
  badge_image TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  title_ar TEXT NOT NULL,
  date TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hospital-news','health-tips','research','events')),
  thumbnail TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  excerpt_ar TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0,
  author TEXT,
  body TEXT NOT NULL DEFAULT '',
  body_ar TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  id UNINDEXED, title, title_ar, excerpt, excerpt_ar, body, body_ar,
  content=articles, content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS doctors_fts USING fts5(
  id UNINDEXED, name, name_ar, specialty, specialty_ar, bio, bio_ar,
  content=doctors, content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(
  id UNINDEXED, title, title_ar, excerpt, excerpt_ar, body, body_ar,
  content=news, content_rowid=rowid
);

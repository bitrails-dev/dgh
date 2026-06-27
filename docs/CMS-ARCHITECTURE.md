# CMS Architecture: SQLite + Vue Dashboard + Astro

## Overview

Replace Decap CMS with a custom Vue.js island dashboard backed by SQLite. Content is authored in SQLite, exported to JSON files, committed to git, and Astro rebuilds the static site.

## Architecture

```
Vue Dashboard → SQLite (local) → export step → JSON/MD files → git commit → Astro rebuild
                      ↓
                  FTS5 search
```

- **SQLite** = editing workspace only, stays on the machine/server, NOT committed to git
- **Exported content files** = what gets committed to git (text, diffable, small)
- **Astro** builds from the content collections (JSON files)

---

## Why Not Commit SQLite to Git

Git stores full copies of binary files on every commit with no delta compression.

| DB Size | Commits/Day | `.git` Size After 30 Days | `git push` Payload |
|---|---|---|---|
| 2 GB | 5 | ~300 GB | Full 2 GB each push |
| 2 GB | 10 | ~600 GB | Full 2 GB each push |
| 2 GB | 20 | ~1.2 TB | Full 2 GB each push |

Git LFS helps (stores one copy, pointers in git) but adds cost, complexity, and still uploads the full binary on each change.

Instead, only the exported text files are committed. Git only diffs and stores what changed (a few KB per commit).

---

## Storage: All Content in SQLite (Not Hybrid)

### Why not split content across files and DB

A hybrid approach (SQLite for metadata + JSON/MD files for content) creates:

- Two sources of truth that must be kept in sync
- Stale index risk for full-text search
- More complex CRUD logic (write to DB + write to file)
- Non-atomic updates (DB write succeeds but file write fails?)

### Recommended: All content in SQLite, export to files for git

Store everything — title, body (markdown/HTML), metadata — directly in SQLite. Use FTS5 for full-text search. A separate export step writes individual content files for git.

**SQLite size estimates:**

| Scenario | Articles | Avg Size per Article | DB Size | With FTS5 Index |
|---|---|---|---|---|
| Small | 10,000 | 15 KB | ~150 MB | ~225 MB |
| Medium | 100,000 | 15 KB | ~1.5 GB | ~2.3 GB |
| Large | 500,000 | 15 KB | ~7.5 GB | ~11 GB |

SQLite handles databases up to 281 TB. Hundreds of thousands of articles is well within its capabilities.

---

## Database Schema

```sql
-- Doctors
CREATE TABLE doctors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  specialty TEXT,
  bio_ar TEXT,
  bio_en TEXT,
  photo TEXT,
  department_id INTEGER,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published',  -- published | draft
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (department_id) REFERENCES departments(id)
);

-- Departments
CREATE TABLE departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  icon TEXT,
  description_ar TEXT,
  description_en TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Categories (hierarchical)
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  parent_id INTEGER,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (parent_id) REFERENCES categories(id)
);

-- Articles / Posts
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body_ar TEXT,
  body_en TEXT,
  excerpt_ar TEXT,
  excerpt_en TEXT,
  category_id INTEGER,
  doctor_id INTEGER,
  featured_image TEXT,
  status TEXT DEFAULT 'draft',  -- published | draft | archived
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

-- Events
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title_ar TEXT NOT NULL,
  title_en TEXT NOT NULL,
  body_ar TEXT,
  body_en TEXT,
  event_date DATE,
  location_ar TEXT,
  location_en TEXT,
  featured_image TEXT,
  status TEXT DEFAULT 'draft',
  published_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Media library
CREATE TABLE media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  alt_ar TEXT,
  alt_en TEXT,
  type TEXT,  -- image | video | document
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Hospital info (key-value for global settings)
CREATE TABLE hospital_info (
  key TEXT PRIMARY KEY,
  value_ar TEXT,
  value_en TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Hero stats (configurable homepage stats)
CREATE TABLE hero_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label_ar TEXT NOT NULL,
  label_en TEXT NOT NULL,
  value TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER DEFAULT 0
);

-- Full-text search index for articles
CREATE VIRTUAL TABLE articles_fts USING fts5(
  title_ar,
  title_en,
  body_ar,
  body_en,
  content=articles,
  content_rowid=id,
  tokenize='unicode61'  -- handles Arabic characters
);

-- Full-text search index for events
CREATE VIRTUAL TABLE events_fts USING fts5(
  title_ar,
  title_en,
  body_ar,
  body_en,
  content=events,
  content_rowid=id,
  tokenize='unicode61'
);

-- Keep FTS in sync with articles
CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title_ar, title_en, body_ar, body_en)
  VALUES (new.id, new.title_ar, new.title_en, new.body_ar, new.body_en);
END;

CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title_ar, title_en, body_ar, body_en)
  VALUES ('delete', old.id, old.title_ar, old.title_en, old.body_ar, old.body_en);
END;

CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title_ar, title_en, body_ar, body_en)
  VALUES ('delete', old.id, old.title_ar, old.title_en, old.body_ar, old.body_en);
  INSERT INTO articles_fts(rowid, title_ar, title_en, body_ar, body_en)
  VALUES (new.id, new.title_ar, new.title_en, new.body_ar, new.body_en);
END;

-- Keep FTS in sync with events
CREATE TRIGGER events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, title_ar, title_en, body_ar, body_en)
  VALUES (new.id, new.title_ar, new.title_en, new.body_ar, new.body_en);
END;

CREATE TRIGGER events_ad AFTER DELETE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, title_ar, title_en, body_ar, body_en)
  VALUES ('delete', old.id, old.title_ar, old.title_en, old.body_ar, old.body_en);
END;

CREATE TRIGGER events_au AFTER UPDATE ON events BEGIN
  INSERT INTO events_fts(events_fts, rowid, title_ar, title_en, body_ar, body_en)
  VALUES ('delete', old.id, old.title_ar, old.title_en, old.body_ar, old.body_en);
  INSERT INTO events_fts(rowid, title_ar, title_en, body_ar, body_en)
  VALUES (new.id, new.title_ar, new.title_en, new.body_ar, new.body_en);
END;
```

---

## Search Strategy

Search is handled differently in the two contexts.

### In the Vue Dashboard (Authoring Side)

SQLite + FTS5 handles search directly. The DB is local/on-server with all content.

```sql
-- Live search as author types
SELECT a.slug, a.title_ar, a.title_en, a.status, a.published_at,
       bm25(articles_fts) as rank
FROM articles_fts f
JOIN articles a ON a.id = f.rowid
WHERE articles_fts MATCH ?
ORDER BY rank
LIMIT 20;
```

### On the Published Static Site (Public Side)

The built Astro site is static — no database at runtime. Options:

#### Option 1 — Build-time search index (simplest)

Astro reads all JSON files during build and generates a pre-computed search index file (`search-index.json`). The client loads it and searches in-browser.

- Libraries: `minisearch`, `fuse.js`, `lunr`
- Up to ~5K articles: works fine
- Beyond that: index file gets too large (tens of MB) for client download

#### Option 2 — Astro server endpoint + SQLite

Add a lightweight API endpoint (Astro server route or tiny Express server) that queries the SQLite DB.

```
User types query → fetch('/api/search?q=...') → server queries SQLite FTS5 → returns results
```

- Scales to any size
- SQLite sits next to the server, near-zero latency
- Good for 5K–50K+ articles

#### Option 3 — External search service

Use Algolia, Meilisearch, or Typesense. Sync content during the export step.

- Best relevance and faceted search features
- Extra dependency and possibly cost
- Best for 50K+ articles or when advanced search features are needed

#### Recommendation by scale

| Scale | Solution |
|---|---|
| Up to ~5K articles | `minisearch` with build-time index |
| 5K–50K articles | Astro server endpoint + SQLite FTS5 |
| 50K+ or faceted search | Meilisearch or Algolia |

For a hospital website, a build-time search index with `minisearch` is likely sufficient.

---

## Content Export Step

After editing in the dashboard, an export script converts SQLite rows to individual JSON files that Astro can consume as content collections.

```
content/
  articles/
    article-slug-1.json
    article-slug-2.json
  doctors/
    doctor-slug-1.json
  departments/
    department-slug-1.json
  events/
    event-slug-1.json
  hospital-info.json
```

Each file is a standalone JSON document with all fields for that record. The export script:

1. Reads all rows that changed since last export (track with `updated_at`)
2. Writes/updates individual JSON files
3. Deletes files for removed records
4. Commits changed files to git
5. Pushes to trigger Astro rebuild

### Example article JSON export

```json
{
  "id": 42,
  "slug": "new-treatment-method",
  "title_ar": "طريقة علاج جديدة",
  "title_en": "New Treatment Method",
  "body_ar": "<markdown content>",
  "body_en": "<markdown content>",
  "excerpt_ar": "...",
  "excerpt_en": "...",
  "category": "research",
  "doctor": "dr-ahmed",
  "featured_image": "/images/treatment.jpg",
  "status": "published",
  "published_at": "2026-04-30T10:00:00Z"
}
```

---

## Workflow Summary

```
┌─────────────────┐
│  Vue Dashboard   │  Author edits content
│  (browser)       │
└────────┬────────┘
         │ write
         ▼
┌─────────────────┐
│  SQLite DB       │  All content + FTS5 search
│  (local/server)  │  NOT in git
└────────┬────────┘
         │ export script
         ▼
┌─────────────────┐
│  JSON/MD files   │  Individual content files
│  (content/)      │  Committed to git
└────────┬────────┘
         │ git push
         ▼
┌─────────────────┐
│  Astro Build     │  Reads content collections
│  (CI/CD)         │  Generates static site
└─────────────────┘
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Admin Dashboard UI | Vue.js 3 (Astro island at `/admin`) |
| Dashboard Server | Cloudflare Workers (Node.js runtime) |
| Database | SQLite 3 + FTS5 |
| DB driver | `better-sqlite3` (Node.js) |
| Content export | Node.js script (`scripts/sync-db.ts`) |
| Public Website | Astro (static HTML/CSS/JS) |
| Hosting | Cloudflare Pages + Cloudflare Workers |
| Search (dashboard) | SQLite FTS5 |
| Search (public site) | Client-side build-time index (minisearch) |
| Version control | Git (JSON content files only, not SQLite) |

## Authentication & Authorization

### Dashboard Access (`/admin`)

- **Method**: Token-based HTTP header
- **Header**: `Authorization: Bearer {ADMIN_TOKEN}`
- **Scope**: Required for all `POST`, `PUT`, `DELETE` operations
- **Read operations**: `GET /api/*` generally don't require auth but can be restricted

### Token Management

- Stored in Cloudflare Worker environment as secret: `ADMIN_TOKEN`
- Must match `PUBLIC_ADMIN_TOKEN` in Astro Pages environment
- Rotate every 90 days in production
- Different tokens for staging/production environments recommended

### Optional: Cloudflare Access

Additional security layer (email-based access):
- Intercepts all requests to `/admin`
- Requires email verification before accessing dashboard
- Configured in Cloudflare dashboard per application

## Development Workflow

### Local Setup

```bash
# Terminal 1: Astro dev server (includes dashboard island)
npm install
npm run dev
# Dashboard at http://localhost:3000/admin

# Terminal 2: Cloudflare Worker (API backend)
cd worker
npm install
npx wrangler dev
# API at http://localhost:8787/api
```

### Content Editing Flow

```
1. Editor opens http://localhost:3000/admin
2. Vue dashboard sends REST requests to Worker API
3. Worker receives request → validates token
4. Worker queries/updates SQLite database
5. Response sent back to dashboard
6. Dashboard updates UI
```

### Content Publishing

After editing is complete:

```bash
# Option A: Using npm script (recommended)
npm run sync:push
# Reads SQLite, exports to JSON files, commits to git

# Option B: Manual export
npm run sync:pull  # Fetch latest from git
npm run sync:push  # Export changes to git
```

Git commit automatically triggers Cloudflare Pages rebuild.

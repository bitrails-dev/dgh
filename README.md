---
marp: false
---

# Al Noor Public Hospital Showcase

A static Astro website for a public hospital showcase in Egypt with a Vue.js admin dashboard backed by Cloudflare Workers and SQLite. Built for high-impact storytelling, bilingual content, and seamless content management.

## Stack

- **Frontend**: Astro (static output) + Vue 3 islands
- **Admin Dashboard**: Vue 3 component running as Astro island
- **Backend/CMS**: Cloudflare Workers with SQLite database
- **Styling**: Tailwind CSS v3
- **Hosting**: Cloudflare Pages (static site) + Cloudflare Workers (API)
- **Content**: SQLite (editing workspace) → JSON exports → Git → Astro rebuild

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Public Website (Astro)                  │
│  Cloudflare Pages ──────────────────────────────────────│  │
│  (Static HTML/CSS/JS)                                   │  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Admin Dashboard (/admin route)                  │
│  Vue.js Island → Calls → Cloudflare Worker API             │
│                                                             │
│  POST /api/articles  ───────────────────┐                  │
│  POST /api/doctors        ┌─────────────┴─────────────┐   │
│  POST /api/news  ──────→  │  Cloudflare Worker        │   │
│  etc.                     │  (Node.js Runtime)        │   │
│                           │                           │   │
│  GET /api/sync/export ──┐ │  ├─ SQLite Database       │   │
│  POST /api/sync/publish │→│  ├─ Export to JSON        │   │
│                         │ │  └─ Git Sync              │   │
│                         │ └─────────────┬─────────────┘   │
│                         │               │                 │
│                         └──────────────→ JSON Files       │
│                                         (content/*)       │
│                                         Committed to git  │
│                                         Triggers rebuild  │
└─────────────────────────────────────────────────────────────┘
```

## Local Development

### Prerequisites
- Node.js 18+
- `better-sqlite3` (included in devDependencies)
- Wrangler CLI for worker development

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Update .env.local with your settings
# - PUBLIC_WORKER_URL: http://localhost:8787 (local dev)
# - PUBLIC_ADMIN_TOKEN: dev-token (local testing)
```

### Running

```bash
# Terminal 1: Astro dev server (includes admin dashboard)
npm run dev

# Terminal 2: Cloudflare Worker (API backend)
cd worker
npm install
npx wrangler dev

# Admin dashboard available at: http://localhost:3000/admin
# Worker API available at: http://localhost:8787/api
```

### Syncing Content

After editing in the admin dashboard:

```bash
# Export SQLite to JSON files
npm run sync:push

# Pull changes from git (if edited externally)
npm run sync:pull
```

## Build & Deployment

### Build Astro Site

```bash
npm run build
# Output: ./dist/
```

### Deploy to Cloudflare Pages

```bash
# Using Wrangler
npx wrangler pages deploy dist

# Or configure in Cloudflare dashboard:
# - Build command: npm run build
# - Build output directory: dist
# - Framework preset: Astro
```

### Deploy Cloudflare Worker

```bash
cd worker

# Deploy to production
npx wrangler deploy

# Check deployment
npx wrangler deployments list
```

## Admin Panel (`/admin`)

The admin panel is a Vue.js island running at `/admin` route. It provides:

- **Articles**: Create, edit, publish articles in Arabic & English
- **Doctors**: Manage staff profiles, specialties, photos
- **Departments**: Configure departments and descriptions
- **News**: Publish news items with dates and images
- **Awards & Achievements**: Manage hospital recognitions
- **Hero Stats**: Configure homepage statistics widget

### Authentication

- Token-based auth via `PUBLIC_ADMIN_TOKEN` header
- Required for all `POST`, `PUT`, `DELETE` endpoints
- Set in worker environment variables (production) or `.env` (local dev)

### Content Export Workflow

1. **Edit in Dashboard**: Vue component sends requests to Worker API
2. **SQLite Storage**: Worker stores in local SQLite database
3. **Export**: Manual export via `npm run sync:push` button or script
4. **Git Commit**: JSON files committed with git
5. **Astro Rebuild**: Cloudflare Pages rebuilds static site from new content

## Environment Variables

### Frontend (.env)

```
PUBLIC_WORKER_URL=http://localhost:8787       # Worker API URL
PUBLIC_ADMIN_TOKEN=change-me-in-production     # API authentication token
```

### Worker (worker/.env or wrangler.toml env)

```
ADMIN_TOKEN=change-me-in-production   # Must match PUBLIC_ADMIN_TOKEN
DATABASE_PATH=/tmp/hospital.db        # SQLite database file (local)
```

## API Endpoints

All endpoints are prefixed with `/api` and require authentication (except `/api/health`).

### Articles
- `GET /api/articles` — List all articles
- `GET /api/articles/:id` — Get article by ID
- `POST /api/articles` — Create article
- `PUT /api/articles/:id` — Update article
- `DELETE /api/articles/:id` — Delete article

### Doctors, Departments, News, Awards, Achievements
Same CRUD pattern as articles.

### Sync Operations
- `GET /api/sync/export` — Export SQLite to JSON files
- `POST /api/sync/import` — Import JSON files to SQLite
- `POST /api/sync/publish` — Commit and push to git

See [CMS-ARCHITECTURE.md](./docs/CMS-ARCHITECTURE.md) for detailed schema and design decisions.
## Security Considerations

1. **Token Management**
   - Change `ADMIN_TOKEN` in production
   - Store in Cloudflare environment variables, never in `.env` files
   - Rotate tokens periodically

2. **Database Backup**
   - SQLite database is local to the Worker and not version-controlled
   - Always perform `sync:push` to export to git before major changes
   - Keep regular backups of the SQLite file

3. **Git Integration**
   - Exported JSON files should be reviewed before commit
   - Use branch protection on `main` branch
   - Require PR review before merging content changes

## Troubleshooting

**"Worker not found" error**: Make sure the Worker is running locally (`npx wrangler dev` in worker folder)

**Admin dashboard is blank**: Check browser console for errors, verify `PUBLIC_WORKER_URL` environment variable is correct

**Changes not syncing**: Run `npm run sync:push` manually to export SQLite to git

**Build fails**: Clear `.astro` cache: `rm -rf .astro && npm run build`

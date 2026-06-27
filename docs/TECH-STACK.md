# Technology Stack

Complete list of technologies, frameworks, and tools used in the Al Noor Hospital Showcase project.

## Frontend / Static Site

| Technology | Version | Purpose |
|---|---|---|
| **Astro** | ^6.1.5 | Static site generator |
| **Vue.js** | ^3.5.31 | Dashboard UI framework |
| **Tailwind CSS** | ^3.4.19 | Utility-first CSS framework |
| **astro-i18next** | ^1.0.0-beta.21 | Bilingual (AR/EN) support |
| **tailwindcss-rtl** | ^0.9.0 | RTL layout support for Arabic |
| **Lucide Vue** | ^1.0.0 | Icon library |
| **gsap** | ^3.14.2 | Animation library (optional) |

### Frontend Integrations

| Tool | Purpose |
|---|---|
| **Astro Vue Integration** (@astrojs/vue) | Run Vue components as islands |
| **Astro Sitemap** (@astrojs/sitemap) | Generate XML sitemap |
| **Astro Tailwind** (@astrojs/tailwind) | Tailwind CSS integration |

## Backend / API

| Technology | Version | Purpose |
|---|---|---|
| **Cloudflare Workers** | Latest | Serverless API backend |
| **SQLite 3** | Latest | Local database |
| **better-sqlite3** | ^11.9.0 | SQLite driver for Node.js |
| **Node.js Runtime** | 18+ | Worker execution environment |

### Backend Features

- **CORS**: Enabled for all origins
- **Authentication**: Token-based (Authorization header)
- **Database**: SQLite with FTS5 full-text search
- **Triggers**: Automatic FTS index updates

## Build & Development Tools

| Tool | Version | Purpose |
|---|---|---|
| **TypeScript** | (via tsx) | Type safety |
| **tsx** | ^4.19.0 | TypeScript executor for scripts |
| **Wrangler** | Latest | Cloudflare Workers CLI |
| **npm** | Latest | Package manager |
| **gray-matter** | ^4.0.3 | YAML/JSON frontmatter parsing |

### npm Scripts

```bash
npm run dev           # Start Astro dev server (includes dashboard)
npm run build        # Build Astro site to dist/
npm run preview      # Preview production build locally
npm run sync:pull    # Pull latest content from git
npm run sync:push    # Export SQLite to JSON and commit to git
npm run migrate      # Run data migrations
```

## Deployment Platform

| Service | Purpose |
|---|---|
| **Cloudflare Pages** | Static site hosting (HTML/CSS/JS) |
| **Cloudflare Workers** | Serverless API backend |
| **Cloudflare D1** | (Future) Managed SQLite database |
| **Cloudflare KV** | (Optional) Key-value cache |
| **Cloudflare Access** | (Optional) Authentication layer |

## Content Management Flow

```
Source Code
├── worker/                (API code + SQLite schema)
├── src/                   (Astro + Vue dashboard)
└── scripts/              (sync-db.ts export script)
        │
        ▼
   Local Development
   npm run dev / npx wrangler dev
        │
        ▼
   Database
   SQLite 3 + FTS5 (local file)
        │
        ▼
   Export Script
   scripts/sync-db.ts
        │
        ▼
   Content Files
   content/articles/*.json
   content/doctors/*.json
        │
        ▼
   Git Repository
   Commit JSON changes
        │
        ▼
   CI/CD (GitHub Actions)
   Detect main branch push
        │
        ▼
   Cloudflare Pages
   npm run build → Astro render
        │
        ▼
   Public Website
   yourhospital.eg
```

## Database Schema

### Tables
- `articles` — Blog posts and editorial content
- `doctors` — Staff profiles
- `departments` — Hospital departments
- `news` — Time-sensitive announcements
- `awards` — Recognitions and certifications
- `achievements` — Hospital accomplishments
- `categories` — Content organization
- `media` — Image/video metadata
- `hospital_info` — Global site settings (key-value)
- `hero_stats` — Homepage statistics widget

### Full-Text Search
- `articles_fts` — FTS5 index for article search
- `events_fts` — FTS5 index for event search
- **Tokenizer**: `unicode61` (supports Arabic)

## Languages & Dialects

| Language | File Type | Purpose |
|---|---|---|
| **TypeScript** | `.ts` | Backend (Worker) + scripts |
| **JavaScript** | `.js` | Frontend (as needed) |
| **Vue 3** | `.vue` | Dashboard components |
| **Astro** | `.astro` | Site pages and layouts |
| **CSS** | `.css` | Tailwind utilities + custom |
| **Markdown** | `.md` | Content and documentation |
| **JSON** | `.json` | Config + exported content |
| **SQL** | `.sql` | Schema (in code comments) |
| **HTML** | (in templates) | Structure |

## Supported Browsers

**Frontend** (Astro output):
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers (iOS Safari, Chrome Mobile)

**Admin Panel** (Vue.js):
- Same as above (requires JavaScript enabled)

**API** (Cloudflare Workers):
- Any HTTP client (curl, fetch, browser)

## Version Control & CI/CD

| Tool | Purpose |
|---|---|
| **Git** | Version control |
| **GitHub** | Repository hosting |
| **GitHub Actions** | (Optional) CI/CD workflows |
| **Wrangler CI/CD** | Deploy Workers (via `wrangler deploy`) |

## Performance Characteristics

| Metric | Target | Notes |
|---|---|---|
| **Astro Build Time** | <60s | Static generation |
| **Worker Cold Start** | <50ms | Cloudflare optimization |
| **SQLite Query** | <100ms | Local database |
| **FTS5 Search** | <10ms | Full-text on 10K articles |
| **Page Load (HTML)** | <1s | Static asset |
| **API Response** | <200ms | Worker + database |

## Security

| Feature | Implementation |
|---|---|
| **Authentication** | Token-based (Bearer token) |
| **Authorization** | Endpoint-level token validation |
| **HTTPS** | Cloudflare automatic (all traffic) |
| **CORS** | Open (configurable per endpoint) |
| **Input Validation** | Framework + application level |
| **SQL Injection** | Parameterized queries (better-sqlite3) |
| **XSS Prevention** | Vue.js automatic escaping |
| **CSRF** | Token in request header |

## Scalability

| Component | Scaling Approach | Limit |
|---|---|---|
| **Static Assets** | Cloudflare global CDN | Unlimited |
| **Worker API** | Automatic horizontal scaling | 10M requests/day (free tier) |
| **SQLite Database** | Single-instance in Worker | ~281 TB max file size |
| **Content Size** | Store all in SQLite | Recommended <5GB |
| **Concurrent Users** | Workers auto-scale | Limited by token throughput |

**Note**: For >100K articles or very high concurrency, consider migrating to Cloudflare D1 (managed database) in the future.

## Optional Future Upgrades

| Technology | Purpose | Cost/Benefit |
|---|---|---|
| **Cloudflare D1** | Replace local SQLite | Distributed, more reliable |
| **Cloudflare KV** | Cache frequently accessed content | Faster reads |
| **Meilisearch** | Advanced search features | Better search UX, external service |
| **Algolia** | Enterprise search | Most powerful, paid service |
| **GitHub Pages** | Alternative static hosting | Free, simpler |
| **Vercel** | Alternative deployment | Better integration with Next.js (if migrating) |
| **Supabase** | Backend-as-a-service | PostgreSQL alternative to SQLite |

## Dependency Management

### Current Dependencies (15 prod + 5 dev)

**Production** (`package.json` dependencies):
- @astrojs/* (3 integrations)
- @vueuse/* (2 utilities)
- astro
- astro-i18next
- gsap
- i18next
- lucide-vue-next
- pinia
- tailwindcss-rtl
- vue

**Development** (`devDependencies`):
- @types/better-sqlite3
- better-sqlite3
- gray-matter
- tailwindcss
- tsx

### Dependency Updates

Run quarterly:
```bash
npm outdated              # Check for updates
npm update               # Update all minor/patch
npm audit                # Check security issues
```

## External Services

| Service | Integration | Cost |
|---|---|---|
| **Cloudflare** | Pages + Workers | Free tier sufficient |
| **GitHub** | Code hosting + OAuth | Free public repo |
| **GitHub Pages** | (Optional) Static deploy | Free |

## Compliance & Standards

| Standard | Compliance | Notes |
|---|---|---|
| **Accessibility** | WCAG 2.1 AA | Target standard |
| **Performance** | Core Web Vitals | Monitored by Cloudflare |
| **SEO** | Astro best practices | Sitemaps, meta tags |
| **Mobile** | Responsive design | Mobile-first approach |
| **Bilingual** | Arabic + English | Full RTL support |

---

**Last updated**: May 5, 2026
**Compatibility**: Current as of this date

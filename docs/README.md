# Documentation Index

Welcome to the Al Noor Hospital Showcase project documentation. This directory contains guides for different aspects of the project.

## Quick Start

**New to the project?** Start here:

1. Read the main [README.md](../README.md) for project overview and setup
2. Run `npm install && npm run dev` to start local development
3. Visit `http://localhost:3000/admin` to access the admin dashboard
4. Create test content and use "Publish to Website" to see it live

## Documentation Files

### [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md)
**For**: Developers, DevOps, architects
**Covers**:
- Technical architecture (Vue Dashboard + Cloudflare Workers + SQLite)
- Database schema and design decisions
- Content export and sync workflow
- Why we chose SQLite over other options
- Search strategy and implementation
- Tech stack details

**When to read**: Understanding the system design, troubleshooting data issues, planning migrations

### [DEPLOYMENT.md](./DEPLOYMENT.md)
**For**: DevOps engineers, deployment specialists
**Covers**:
- Step-by-step deployment to Cloudflare Pages and Workers
- Environment variable configuration
- Security setup (tokens, access controls)
- DNS configuration
- Monitoring and troubleshooting
- Rollback procedures
- Performance optimization
- Maintenance schedules

**When to read**: Setting up production, troubleshooting deployment issues, rotating secrets

### [ADMIN-PANEL-GUIDE.md](./ADMIN-PANEL-GUIDE.md)
**For**: Content editors, administrators, non-technical staff
**Covers**:
- How to use the admin panel (`/admin`)
- Creating, editing, publishing content
- Managing articles, doctors, departments, news, etc.
- Best practices for content
- Keyboard shortcuts
- Common troubleshooting
- What to do when things go wrong

**When to read**: Learning to edit content, publishing articles, managing website content

## By Role

### Content Editors
1. Start with [ADMIN-PANEL-GUIDE.md](./ADMIN-PANEL-GUIDE.md)
2. Reference [PRODUCT.md](../PRODUCT.md) for brand voice and tone
3. Check [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md) if curious about how data flows

### Website Developers
1. Read [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md) for system design
2. Check [README.md](../README.md) for local development setup
3. Review Astro components in `src/` directory
4. Reference Tailwind CSS for styling guidelines

### DevOps / Infrastructure
1. Start with [DEPLOYMENT.md](./DEPLOYMENT.md)
2. Review [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md) for system components
3. Reference Cloudflare configuration files (wrangler.toml)
4. Set up monitoring and alerting per maintenance section

### Project Managers / Stakeholders
1. Read [PRODUCT.md](../PRODUCT.md) for product vision and brand
2. Skim [README.md](../README.md) for technology overview
3. Reference [DEPLOYMENT.md](./DEPLOYMENT.md) → Monitoring section for status checks

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│       Content Editors (Admin Panel)             │
│  /admin → Vue.js Island                         │
└──────────────┬──────────────────────────────────┘
               │ REST API calls
               ▼
┌─────────────────────────────────────────────────┐
│   API Server (Cloudflare Workers)               │
│  /api/articles, /api/doctors, etc.              │
└──────────────┬──────────────────────────────────┘
               │ Read/Write
               ▼
        ┌─────────────┐
        │  SQLite DB  │
        └─────────────┘
               │ Export (npm run sync:push)
               ▼
        ┌─────────────┐
        │ JSON Files  │
        │ (content/*) │
        └──────┬──────┘
               │ Committed to Git
               ▼
        ┌──────────────┐
        │  GitHub      │
        └──────┬───────┘
               │ Webhook trigger
               ▼
    ┌────────────────────┐
    │ Cloudflare Pages   │
    │ (Astro Build)      │
    └────────────────────┘
               │
               ▼
    ┌────────────────────┐
    │  Public Website    │
    │  yourhospital.eg   │
    └────────────────────┘
```

**See also**: [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md) → Workflow Summary section

## Common Tasks

### Publishing New Content
→ [ADMIN-PANEL-GUIDE.md](./ADMIN-PANEL-GUIDE.md) → Common Tasks

### Deploying to Production
→ [DEPLOYMENT.md](./DEPLOYMENT.md) → Step 1-6

### Understanding the System
→ [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md) → Overview

### Troubleshooting Issues
→ See role-specific guides above, or search issue type:

- **"Can't log in"** → [ADMIN-PANEL-GUIDE.md](./ADMIN-PANEL-GUIDE.md) → Troubleshooting
- **"API errors"** → [ADMIN-PANEL-GUIDE.md](./ADMIN-PANEL-GUIDE.md) → Troubleshooting
- **"Website not updated"** → [ADMIN-PANEL-GUIDE.md](./ADMIN-PANEL-GUIDE.md) → Troubleshooting
- **"Build failed"** → [DEPLOYMENT.md](./DEPLOYMENT.md) → Troubleshooting
- **"Database issue"** → [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md) → Database Schema

## Project Structure

```
hospital/codex-v2/
├── src/                           # Astro site + dashboard
│   ├── pages/
│   │   ├── index.astro           # Homepage
│   │   └── admin.astro           # Admin panel entry point
│   ├── components/
│   │   ├── dashboard/            # Vue dashboard components
│   │   ├── layout/               # Site layout components
│   │   └── ...
│   └── styles/                   # CSS
│
├── worker/                        # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts              # Router setup
│   │   ├── handlers/             # Endpoint handlers (articles, doctors, etc.)
│   │   ├── middleware/           # Auth, logging
│   │   ├── db/                   # SQLite operations
│   │   └── router.ts             # URL routing
│   └── wrangler.toml             # Worker config
│
├── scripts/                       # Build/sync scripts
│   ├── sync-db.ts                # Export/import content
│   └── migrate-content.ts        # Data migrations
│
├── docs/                          # Documentation (you are here)
│   ├── README.md                 # This file
│   ├── CMS-ARCHITECTURE.md       # Technical design
│   ├── DEPLOYMENT.md             # Deploy procedures
│   └── ADMIN-PANEL-GUIDE.md      # User guide
│
├── content/                       # Exported content (JSON files)
│   ├── articles/
│   ├── doctors/
│   ├── departments/
│   └── ...
│
├── README.md                      # Main project README
├── PRODUCT.md                     # Product vision & brand
├── astro.config.mjs              # Astro configuration
├── package.json                  # Frontend dependencies
└── .env.example                  # Environment template
```

## Environment Variables

### Local Development (.env.local)

```
PUBLIC_WORKER_URL=http://localhost:8787
PUBLIC_ADMIN_TOKEN=dev-token
WORKER_URL=http://localhost:8787
ADMIN_TOKEN=dev-token
```

### Production (Cloudflare environments)

See [DEPLOYMENT.md](./DEPLOYMENT.md) → Step 1.3 & 2.3

## Support & Getting Help

1. **Check the relevant guide** based on your role (see "By Role" section above)
2. **Search the docs** for your issue type
3. **Check browser console** (F12 → Console tab) for error details
4. **Check Worker logs** (`npx wrangler tail --env production`)
5. **Review git history** (`git log --oneline`) to see what changed recently
6. **Contact team lead** if issue persists

## Keeping Docs Updated

When making changes to the project:

- **Architecture changes** → Update [CMS-ARCHITECTURE.md](./CMS-ARCHITECTURE.md)
- **Deploy procedure changes** → Update [DEPLOYMENT.md](./DEPLOYMENT.md)
- **New features or UI changes** → Update [ADMIN-PANEL-GUIDE.md](./ADMIN-PANEL-GUIDE.md)
- **Project goals change** → Update [../PRODUCT.md](../PRODUCT.md)
- **Setup/build changes** → Update [../README.md](../README.md)

Always keep docs in sync with code—outdated documentation causes confusion and bugs.

---

**Last updated**: May 5, 2026
**Project**: Al Noor Hospital Showcase (codex-v2)
**Maintainers**: Development team

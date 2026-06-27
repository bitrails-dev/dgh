# Deployment Guide

This guide covers deploying both the Astro website and Cloudflare Worker API to production.

## Prerequisites

- Cloudflare account with Pages and Workers enabled
- Git repository with main branch
- Node.js 18+
- Wrangler CLI: `npm install -g @cloudflare/wrangler`

## Architecture

```
┌──────────────┐              ┌──────────────┐
│ Astro Build  │──committed──→│ Git + GitHub │
│ (dist/)      │              │              │
└──────────────┘              └──────┬───────┘
                                     │
        ┌────────────────────────────┴────────┐
        │                                     │
        ▼                                     ▼
┌──────────────────────┐          ┌─────────────────────┐
│ Cloudflare Pages     │          │ GitHub Actions      │
│ (Static Website)     │          │ (CI/CD Workflow)    │
│ yourhospital.eg      │          │                     │
└──────────────────────┘          └──────────┬──────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │ Cloudflare Workers  │
                                  │ (API Backend)       │
                                  │ yourhospital.eg/api │
                                  └─────────────────────┘
```

## Step 1: Cloudflare Pages Setup

### 1.1 Connect Repository

1. Go to Cloudflare Dashboard → Pages
2. Click "Create a project"
3. Select "Connect to Git" → authorize GitHub
4. Select your repository
5. Click "Begin setup"

### 1.2 Configure Build

**Project name**: `hospital-website` (or your choice)

**Build settings**:
- Framework preset: `Astro`
- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: `/` (or `/codex-v2` if monorepo)

### 1.3 Environment Variables

Set these in Cloudflare Pages → Settings → Environment:

**Production**:
- `PUBLIC_WORKER_URL` = `https://hospital-api.yourdomain.com` (Worker URL)
- `PUBLIC_ADMIN_TOKEN` = `[SECURE_TOKEN]` (matches Worker token)

**Preview** (optional, for PR previews):
- Same as production, or point to staging Worker

### 1.4 Deploy

Click "Save and Deploy". Cloudflare will trigger a build immediately.

**Your site is now live at**: `https://hospital-website.pages.dev` or your custom domain

## Step 2: Cloudflare Workers Setup

### 2.1 Create Worker

```bash
cd worker
npx wrangler deploy
```

This creates a new Worker service. Note the URL (e.g., `hospital-api.yourdomain.workers.dev`).

### 2.2 Configure Worker Environment

In `worker/wrangler.toml`, add environment-specific settings:

```toml
[env.production]
name = "hospital-api"
routes = [
  { pattern = "api.yourhospital.eg/api/*", zone_name = "yourhospital.eg" }
]
env_vars = { ADMIN_TOKEN = "your-secure-token" }

[env.staging]
name = "hospital-api-staging"
env_vars = { ADMIN_TOKEN = "staging-token" }
```

### 2.3 Set Secrets

Store sensitive data as Cloudflare Secrets (not in `wrangler.toml`):

```bash
npx wrangler secret put ADMIN_TOKEN --env production
# Paste your secure token, press Enter
```

Verify:
```bash
npx wrangler secret list --env production
```

### 2.4 Deploy

```bash
# Deploy to production
npx wrangler deploy --env production

# Or staging
npx wrangler deploy --env staging
```

**Your API is now live at**: `https://hospital-api.yourhospital.eg` (if custom domain configured)

## Step 3: Connect Worker to Pages

### 3.1 Add Custom Domain to Worker

1. Go to Cloudflare Dashboard → Workers & Pages → hospital-api
2. Click "Triggers" → "Custom domains"
3. Add: `api.yourhospital.eg` (or subdomain of choice)
4. Point your DNS to Cloudflare nameservers (if not already)

### 3.2 Update Pages Environment Variable

Update `PUBLIC_WORKER_URL` in Cloudflare Pages environment:

```
PUBLIC_WORKER_URL = https://api.yourhospital.eg
```

Redeploy Pages to pick up the new variable.

## Step 4: Enable Admin Panel Security

### 4.1 Cloudflare Access (Optional but Recommended)

Add an additional security layer to `/admin`:

1. Go to Cloudflare Dashboard → Access → Applications
2. Click "Create an application"
3. Choose "Self-hosted" application
4. **Application name**: Hospital Admin
5. **Subdomain**: `yourhospital.eg` (if applicable)
6. **Path**: `/admin*`
7. **Application type**: `SaaS`

Add access policy:
- **Action**: Allow
- **Selector**: `Emails matching`
- **Value**: `editor@yourhospital.eg`, `admin@yourhospital.eg`

This requires users to authenticate with their email + one-time code before accessing `/admin`, even before the Vue dashboard loads.

### 4.2 API Token Rotation

Update the `ADMIN_TOKEN` every 90 days:

```bash
# Generate new token
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Update in Cloudflare
npx wrangler secret put ADMIN_TOKEN --env production
```

Update in Pages environment variables too.

## Step 5: Git Sync & Content Publishing

### 5.1 GitHub Secrets (for CI/CD)

If using GitHub Actions to auto-publish content:

Go to GitHub Settings → Secrets → New repository secret:

- `CLOUDFLARE_API_TOKEN` = Your Cloudflare API token (from Profile → API Tokens)
- `CLOUDFLARE_ACCOUNT_ID` = Your Cloudflare Account ID
- `ADMIN_TOKEN` = The same token as your Worker

### 5.2 Manual Content Publishing

After editing in the admin dashboard:

```bash
# Export SQLite to JSON files
npm run sync:push

# This commits JSON files to git. Then:
git push origin main

# Cloudflare Pages automatically rebuilds when main branch changes
```

## Step 6: Monitoring & Logs

### Check Worker Logs

```bash
npx wrangler tail --env production
```

### Check Pages Build Logs

In Cloudflare Dashboard → Pages → hospital-website → Deployments, click a deployment to see build logs.

### Error Tracking

Monitor for:
- **403 Unauthorized**: Check `ADMIN_TOKEN` matches in Pages + Worker
- **404 Not Found**: Verify `PUBLIC_WORKER_URL` is correct
- **CORS errors**: Check Worker CORS headers (should allow all origins)
- **SQLite errors**: Check Worker logs for database access issues

## Rollback Procedure

### Rollback Pages Deployment

1. Go to Cloudflare Dashboard → Pages → hospital-website → Deployments
2. Find the previous successful deployment
3. Click "Rollback to this deployment"

### Rollback Worker

```bash
npx wrangler deployments list --env production
npx wrangler rollback --env production
# Confirm the deployment ID to revert to
```

## DNS Configuration

If using a custom domain (`yourhospital.eg`):

| Record | Type | Name | Target | TTL |
|--------|------|------|--------|-----|
| Website | CNAME | yourhospital.eg | hospital-website.pages.dev | Auto |
| API | CNAME | api.yourhospital.eg | hospital-api.yourhospital.workers.dev | Auto |

## Performance Optimization

### Cloudflare Cache

Enable caching for Worker responses:

In `worker/src/index.ts`:

```ts
response.headers.set('Cache-Control', 'public, max-age=3600');
```

For read-only endpoints like `GET /api/articles`, cache aggressively. For write operations, don't cache.

### Pages Caching

Static Astro output is cached by default. To clear cache:

1. Cloudflare Dashboard → Caching → Cache Rules
2. Create a rule: `Hostname = yourhospital.eg` → Purge cache on deploy

## Troubleshooting

### Pages Deployment Fails

```bash
# Test build locally
npm run build
ls dist/

# If dist is empty, check:
# - npm install worked
# - No build errors in logs
# - astro.config.mjs is valid
```

### Worker Deployment Fails

```bash
# Test locally first
cd worker && npx wrangler dev

# Check for errors, then try deploy with verbose output
npx wrangler deploy --env production --verbose
```

### Admin Panel 403 Errors

1. Verify `PUBLIC_ADMIN_TOKEN` in Pages matches Worker `ADMIN_TOKEN`
2. Check Cloudflare Access rules (if enabled)
3. Try with `curl`:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://api.yourhospital.eg/api/health
```

### Database Locked Errors

Multiple Workers instances trying to write to SQLite simultaneously:

1. Use D1 (Cloudflare's serverless database) instead of local SQLite (future)
2. For now, ensure only one deployment is active
3. Stagger exports to avoid concurrent writes

## Maintenance

### Weekly
- Monitor Worker logs for errors
- Check Pages build success rate

### Monthly
- Rotate `ADMIN_TOKEN`
- Review access logs
- Test disaster recovery (rollback procedure)

### Quarterly
- Update dependencies: `npm update`
- Audit Cloudflare settings for security
- Review database backups (exported JSON files)

## Support Resources

- [Cloudflare Pages Docs](https://developers.cloudflare.com/pages/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Astro Deployment Guide](https://docs.astro.build/en/guides/deploy/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)

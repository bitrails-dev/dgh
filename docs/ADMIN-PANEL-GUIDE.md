# Admin Panel User Guide

## Overview

The admin panel (`/admin`) is a Vue.js application for managing hospital content. It runs as an Astro island and communicates with a Cloudflare Worker API backend.

## Accessing the Admin Panel

1. Local development: `http://localhost:3000/admin`
2. Staging: `https://staging.yourhospital.eg/admin`
3. Production: `https://yourhospital.eg/admin`

**Requirements**: You must have the `ADMIN_TOKEN` for API authentication.

## Dashboard Overview

The dashboard is organized into tabs for different content types:

### 1. Overview (Home)

Summary statistics and quick actions:
- Total articles, doctors, departments
- Recent edits
- Publish status (how many items are draft vs. published)
- Quick links to other sections

### 2. Articles

Manage blog posts, news articles, and editorial content.

**Fields**:
- **Title** (Arabic & English): Displayed as the article headline
- **Body** (Arabic & English): Main content, supports markdown or HTML
- **Excerpt** (Arabic & English): Summary shown in listings
- **Category**: Organize articles into topics
- **Featured Image**: Thumbnail for article listings
- **Status**: `draft` (hidden) or `published` (public)
- **Published At**: Timestamp when article went live

**Actions**:
- **Create**: Click "New Article" → fill form → Save
- **Edit**: Click article row → modify fields → Save
- **Delete**: Select article → click Delete (will confirm)
- **Publish**: Toggle status to "published" to make visible on site

**Tips**:
- Drafts are saved immediately but not shown publicly
- Use excerpts for preview text in listings
- Both Arabic and English are required for bilingual display
- Featured image should be ~16:9 ratio (recommended 1200×675px)

### 3. Doctors

Manage staff profiles and credentials.

**Fields**:
- **Name** (Arabic & English): Doctor's full name
- **Specialty**: e.g., "Cardiology", "Orthopedics"
- **Bio** (Arabic & English): Professional biography
- **Department**: Assign to a specific department
- **Photo**: Profile picture (headshot, ~1:1 ratio)
- **Sort Order**: Number to control display order

**Actions**:
- Create doctor profiles
- Link to departments
- Reorder with sort numbers
- Upload profile photos

**Tips**:
- Photos should be professional headshots
- Specialty field helps with filtering on public site
- Sort order: 1 = first in list, higher numbers = later

### 4. Departments

Configure hospital departments and their descriptions.

**Fields**:
- **Name** (Arabic & English): Department name
- **Icon**: Icon identifier (e.g., "heart", "brain")
- **Description** (Arabic & English): What the department does
- **Sort Order**: Display order

**Actions**:
- Create/edit departments
- Add descriptions for public display
- Assign doctors to departments (via Doctors tab)

### 5. News

Time-sensitive announcements and events.

**Fields**:
- **Title** (Arabic & English): News headline
- **Body** (Arabic & English): Full news content
- **Event Date**: When the news is relevant
- **Location** (Arabic & English): Where it happened
- **Featured Image**: Thumbnail for news listings
- **Status**: Published or draft
- **Published At**: When it was announced

**Actions**:
- Create breaking news
- Schedule posts (set published_at to future date)
- Attach location information
- Upload images

### 6. Awards & Achievements

Manage recognitions and certifications.

**Fields**:
- **Title** (Arabic & English): Award name
- **Description** (Arabic & English): Award details
- **Date**: When awarded
- **Organization**: Who gave the award
- **Category**: Type of achievement

**Actions**:
- Add new awards and certifications
- Highlight hospital accomplishments
- Control display order

### 7. Hero Stats (Homepage Widget)

Configure the statistics shown on the homepage hero section.

**Fields**:
- **Label** (Arabic & English): Stat name (e.g., "Patients Served")
- **Value**: The number or metric (e.g., "500,000")
- **Icon**: Icon to display next to stat
- **Sort Order**: Display order

**Actions**:
- Edit existing stats
- Change values and icons
- Reorder for visual priority

**Example**:
```
Label: Patients Served | Value: 500,000 | Icon: user-check
Label: Expert Doctors  | Value: 200+     | Icon: stethoscope
```

## Common Tasks

### Adding a New Article

1. Navigate to **Articles** tab
2. Click **"New Article"**
3. Fill in **Title** (both languages)
4. Enter **Body** content
5. Add **Featured Image**
6. Set **Status** to `published`
7. Click **Save**
8. Click **Publish** to make live

### Publishing Content

After making changes:

1. Ensure all required fields are filled
2. Set **Status** to `published`
3. Click **Save**
4. Go to **Overview** tab
5. Click **Publish to Website**
   - This exports changes to JSON files
   - Commits to git
   - Triggers Astro rebuild
   - Changes appear on live site in ~5 minutes

### Bulk Editing

To change multiple items at once:

1. Select items using checkboxes
2. Click **"Bulk Edit"**
3. Choose fields to update
4. Apply changes

### Reverting Changes

If you made a mistake before publishing:

1. Look for **"Undo"** option (if recent change)
2. Or reload the page to discard unsaved changes

If already published:

1. Make corrections in the dashboard
2. Click **Publish** again
3. Changes go live within 5 minutes

## Best Practices

### Content Quality

- ✅ Always fill both Arabic AND English fields (bilingual)
- ✅ Use clear, professional language
- ✅ Keep excerpts under 160 characters
- ✅ Include featured images for visual interest
- ✅ Review spelling and formatting before publishing

### Media Management

- ✅ Use appropriately sized images (avoid huge files)
- ✅ Add descriptive alt text to images
- ✅ Compress images before upload if possible
- ✅ Keep consistent style (lighting, colors, composition)

### Organization

- ✅ Use categories and departments to organize content
- ✅ Set sort orders consistently
- ✅ Review published content regularly
- ✅ Archive or delete obsolete information

### Publishing Workflow

1. **Draft Phase**: Create and refine content (Status: `draft`)
2. **Review Phase**: Have someone else review if possible
3. **Publish Phase**: Set Status to `published` and click Publish
4. **Monitor Phase**: Check website for correct display
5. **Update Phase**: Make corrections if needed and republish

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+S` or `Cmd+S` | Save current item |
| `Ctrl+B` | Bold text (in text editors) |
| `Ctrl+I` | Italic text |
| `Esc` | Close modal/cancel edit |

## Troubleshooting

### "Cannot connect to API"

**Problem**: Dashboard shows error when trying to save

**Solution**:
1. Check that Worker is running (`npx wrangler dev` in worker folder)
2. Verify `PUBLIC_WORKER_URL` in `.env.local` is correct
3. Check browser console (F12) for detailed error message
4. Restart both Astro (`npm run dev`) and Worker

### "Unauthorized (401)"

**Problem**: API returns 401 error when saving

**Solution**:
1. Verify `PUBLIC_ADMIN_TOKEN` matches Worker `ADMIN_TOKEN`
2. Check `.env.local` has correct token
3. Restart Astro dev server to reload env variables
4. Make sure you're not using an expired/rotated token

### "Publish failed"

**Problem**: "Publish" button doesn't work

**Solution**:
1. Try manually: `npm run sync:push`
2. Check if git is properly configured
3. Ensure you have write access to the repository
4. Check git error messages in terminal output

### Changes not showing on website

**Problem**: Published content not appearing after 5 minutes

**Solution**:
1. Verify Status is set to `published`
2. Check that Publish action completed (check terminal for git commit)
3. Visit Cloudflare Pages dashboard → Deployments (check build status)
4. Try hard refresh browser (Ctrl+Shift+R)
5. Wait up to 10 minutes for CDN cache to clear

### Lost unsaved changes

**Problem**: Accidentally closed browser before saving

**Solution**:
- Content is not persisted until you click Save
- Use browser's back button to go back if form is still open
- Always click Save before navigating away

## API Token

**Important**: Never share your `ADMIN_TOKEN` with unauthorized users.

**If token is compromised**:
1. Go to Cloudflare Dashboard → Workers
2. Update the `ADMIN_TOKEN` secret
3. Update Pages environment variables
4. All old tokens immediately become invalid

## Support

For issues or feature requests:
1. Check this guide for troubleshooting steps
2. Review browser console (F12 → Console tab) for error messages
3. Check Worker logs: `npx wrangler tail`
4. Contact your system administrator

## Quick Reference

**URLs**:
- Admin Dashboard: `/admin`
- Public Website: `/`
- API Health Check: `/api/health`

**Commands**:
```bash
npm run dev           # Start Astro + dashboard
cd worker && npx wrangler dev  # Start API
npm run sync:push    # Publish changes to git
npm run sync:pull    # Pull latest from git
```

**Required Fields** (all tabs):
- Arabic title/name
- English title/name
- Status (published or draft)

**Optional Fields**: Most other fields are optional, but recommended for complete content.

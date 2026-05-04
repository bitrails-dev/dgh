---
date: "2026-05-01 07:20"
promoted: false
tags: [prompt, design, architecture]
---

# Design Prompt: Composable Multi-Tenant Static Site Platform

---

## Context to Set Before You Paste This Prompt

This prompt is designed to open a deep architectural discussion with an AI model.
Paste it as your first message. Do not summarize or truncate it.
The AI should ask clarifying questions before recommending approaches.

---

## The Prompt

---

I am designing a **composable, multi-tenant, statically generated web platform** and I need your help investigating the best architectural approaches to implement it. Before giving recommendations, I want you to ask me clarifying questions — do not assume. Understand my constraints fully before proposing solutions.

Here is the problem space. Read it carefully.

---

### What We Are Building

A software platform that produces **multiple distinct websites from a single shared codebase**. Each website belongs to a different client (tenant). Each tenant gets their own domain, their own brand identity, their own content, their own page structure, their own component selection, and their own backend data. Despite all of this variation, all tenants are built from the same underlying component library, design system, and toolchain.

The domain is **not the point** — the pattern is. Think of this as a white-label website-as-a-product platform where:

- The **product** is the website platform (codebase, components, design system, build toolchain)
- The **tenant** is any organization that needs a website with its own look, content, and data
- The **output** is a fully static, pre-rendered website per tenant — hosted independently

The specific domain I am working in involves content-rich institutional websites for organizations that have: team directories, service listings, event walls, booking flows, procedural documentation (step-by-step guides with requirements), and a member/patient portal backed by a live API.

---

### Core Architectural Constraints

These are non-negotiable. Every approach you propose must respect them:

1. **The output is always fully static HTML/CSS/JS.** No server-side rendering at request time. No edge rendering of page structure. The website is pre-rendered at build time and deployed to a CDN. This is a hard constraint — SSR is off the table for page rendering.

2. **The backend is always a pure API.** It serves JSON. It handles authentication, live data (appointments, availability, user sessions), and transactional operations. It never participates in rendering HTML. The backend is deployed separately from the website.

3. **Multi-tenancy is resolved at build time, not at runtime.** There is no runtime tenant detection. A build is always for exactly one tenant. The tenant's configuration is the input; the static website is the output.

4. **One codebase, many configs, many builds.** A single source repository contains the full component library, page templates, layouts, design system, and build toolchain. Each tenant has a configuration file (or set of files) that shapes the build. Running the build for tenant A produces a completely different website from tenant B, using the same underlying code.

5. **SEO is a first-class requirement.** Every page must be indexable, have correct canonical URLs, structured data (Schema.org), Open Graph metadata, XML sitemaps, and human-readable URLs. Since the output is static, SEO cannot be an afterthought — it must be baked into the architecture.

6. **GEO (Generative Engine Optimization) is also required.** The content and markup must be structured in a way that AI systems (LLMs, AI search engines, answer engines) can accurately extract, summarize, and cite the website's content. This means semantic HTML, machine-readable structured data, answer-ready content blocks, and consistent factual signals across the site.

7. **The platform must support RTL and LTR languages.** Multi-locale support (at minimum two languages per tenant) is required. Direction, typography, and layout must adapt per locale. Both locales of a tenant are produced in the same build and deployed together.

---

### The Composition Model

This is the heart of what I need help thinking through.

The platform uses a **composable section system**. A page is not a fixed template — it is a sequence of sections assembled from a configuration. Each section is a named family of layout variants. The tenant config selects which variant of each section to use, in what order, with what props, and with what animation style.

For example:

- A `HeroSection` is not one component. It is a family: `fullscreen`, `split-media`, `minimal`, `carousel`, `video-background`. Each variant has a different layout, different animation behavior, and potentially a different data shape (props).
- A `TeamSection` is a family: `card-grid`, `horizontal-scroll`, `featured-spotlight`, `compact-list`.
- A `ServicesSection` is a family: `icon-tiles`, `accordion`, `full-cards`, `tabbed-panels`.

The tenant config declares:
```
HeroSection / variant: split-media / animation: fade-in / props: { ctaLabel, mediaPosition }
TeamSection / variant: card-grid   / animation: stagger  / props: { limit, showSpecialty }
```

And the build produces a page with exactly those sections, in that order, with that data.

Every section variant shares the same design tokens (colors, fonts, spacing, radius) so the brand remains consistent regardless of which structural variant is chosen. Tokens are resolved at build time and baked into the CSS — not applied at runtime.

The animation config is separate from the layout. A wrapper applies motion to any section variant using a shared animation system — variants themselves contain no animation code.

---

### What the Tenant Config Controls

I want you to help me think through the right shape and scope of the tenant configuration system. At minimum it must cover:

- **Design tokens** — brand colors, typography, spacing scale, border radius style, visual density
- **Layout shell** — which overall page layout to use (e.g. sidebar navigation, top navigation, minimal)
- **Page composition** — for each page type (home, team, service, detail, portal), which section variants appear in what order, with what props and what animation
- **Feature flags** — which platform features are enabled for this tenant (booking, portal, events wall, procedures, awards, etc.)
- **Content sources** — where this tenant's content lives (team members, services, events, procedures, etc.)
- **Locale config** — which languages are supported, which is the default, direction per locale
- **API config** — which backend API endpoint this tenant's interactive features connect to

I need to understand: what is the right format for this config? What are the tradeoffs between TypeScript config files, JSON, YAML, a database-backed admin UI, or a hybrid approach? What breaks at scale when you have 50 tenants? 200?

---

### The Build Pipeline

The build takes a tenant identifier, loads that tenant's config, and runs the static site generator with the config injected. The output is a complete, self-contained static website for that tenant.

Key questions I want to explore:

- How should the build pipeline be structured to support building one tenant, all tenants in parallel, or a subset?
- How should tenant-specific content (team member pages, service pages, event listings) be handled — as files in the repository, fetched from a CMS at build time, or fetched from the API backend?
- How should the build handle shared assets (component library) vs tenant-specific assets (logo, hero images, brand fonts)?
- What is the right CI/CD model for this? When a component is updated in the base codebase, how do all tenant builds get triggered and deployed?
- How do you handle a tenant-specific content update (e.g. a new doctor added) without a full codebase rebuild?

---

### SEO Requirements (Detailed)

Because the output is static and serves institutional organizations, SEO is a core product requirement:

- **Structured data**: Schema.org markup appropriate to the domain (Organization, LocalBusiness, Person for team members, Service, Event, HowTo for procedural content, FAQPage, BreadcrumbList). All structured data must be generated at build time from content, not hardcoded.
- **Canonical URLs**: Each page has one canonical URL. Multi-locale pages have `hreflang` annotations. The default locale does not get a language prefix in the URL (e.g. Arabic at `/`, English at `/en/`).
- **Sitemaps**: Auto-generated XML sitemaps per tenant, covering all page types including collection pages (team, services, events, departments). Sitemap must be locale-aware.
- **Open Graph / Twitter Cards**: Auto-generated per page from content, with fallback to tenant-level defaults.
- **Page titles and meta descriptions**: Templated and generated from content at build time. No hardcoded strings.
- **Performance as SEO signal**: The static output must achieve Core Web Vitals targets. CSS must not block rendering. Fonts must not cause layout shift. Images must have explicit dimensions.
- **Internal linking**: Section variants that list team members, services, or departments must link to individual detail pages. No orphan pages.

---

### GEO Requirements (Generative Engine Optimization)

AI answer engines (Perplexity, ChatGPT Search, Google AI Overviews, Claude, etc.) crawl and index web content. For institutional websites, being accurately cited and summarized by AI engines is increasingly important. The architecture must support:

- **Factual consistency**: The same factual information (organization name, address, phone, services offered, team members and their roles) must appear in consistent form across: page content, Schema.org JSON-LD, Open Graph metadata, and sitemap. Inconsistency confuses AI extractors.
- **Answer-ready content blocks**: Key factual content should be structured as discrete, self-contained blocks — not buried in long paragraphs. A services page should have each service as a named, described, discrete block. A procedures page should have explicit step-by-step structure. A team page should have each person as a structured entity.
- **Semantic HTML**: Use the right element for the right meaning. `<article>`, `<section>`, `<nav>`, `<main>`, `<aside>`, `<address>`, `<time datetime>`, `<dl>/<dt>/<dd>` for structured definitions. AI parsers weight semantic structure.
- **Named entity clarity**: Organization names, person names, location names, and service names should appear consistently and completely — not abbreviated differently on different pages.
- **`llms.txt` support**: Consider generating a `llms.txt` file per tenant (a machine-readable index of the site's key facts and pages, designed for LLM crawlers). This is an emerging standard.
- **FAQ and HowTo schema**: Procedural content (step-by-step guides) and common questions should be marked up with `HowTo` and `FAQPage` schema — these are high-signal for AI extraction.
- **Citation-friendly structure**: Each page should have a clear, unambiguous title, a concise description in the first paragraph, and a structured body. AI engines cite pages that are easy to quote accurately.

---

### What I Need From You

I am not asking you to recommend a specific tech stack yet. I am asking you to:

1. **Ask me clarifying questions** about anything in this problem space that is ambiguous or underspecified. Dig deep — the quality of the architecture depends on understanding the constraints fully.

2. **Identify the core tensions** in this design. Where do the requirements pull in opposite directions? (e.g. "build-time composition" vs "content freshness", "static output" vs "personalized portal experience", "SEO baked at build time" vs "content that changes frequently")

3. **Map the decision points** — what are the five to ten architectural decisions where the choice made will have the most downstream impact? Frame each as a question with the key tradeoffs, not a recommendation.

4. Once we have explored the problem space together, **propose two or three distinct architectural approaches** — not just one — so we can compare them against the constraints.

5. Throughout the discussion, **flag any assumption you are making** about my constraints. I may correct you, and that correction will change the recommendation.

Do not start with "here are the best approaches." Start with questions.

---

*End of prompt.*

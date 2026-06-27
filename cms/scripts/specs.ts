// Single source of the Payload <-> Astro-markdown mapping, used by both
// export-to-content.ts and import-from-content.ts. Frontmatter keys here MUST match
// ../../src/content.config.ts exactly, or the Astro build will reject the files.

// Localized fields come back from payload.find({ locale: 'all' }) as { en, ar }.
export const en = (v: any): string => (v && typeof v === 'object' ? (v.en ?? v.ar ?? '') : (v ?? ''))
export const ar = (v: any): string => (v && typeof v === 'object' ? (v.ar ?? v.en ?? '') : (v ?? ''))
const ymd = (v: any): string => (v ? new Date(v).toISOString().slice(0, 10) : '')
const omitEmpty = (o: Record<string, any>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))

export type Spec = {
  collection: string
  dir: string // under src/content
  toFile: (d: any) => { slug: string; frontmatter: Record<string, any>; body: string }
  toData: (fm: Record<string, any>, body: string, slug: string) => {
    ar: Record<string, any> // create payload (default locale) — includes slug + non-localized + AR
    en: Record<string, any> // update payload for the EN locale — localized fields only
  }
}

export const SPECS: Spec[] = [
  {
    collection: 'doctors',
    dir: 'doctors',
    toFile: (d) => ({
      slug: d.slug,
      frontmatter: omitEmpty({
        name: en(d.name), nameAr: ar(d.name),
        specialty: en(d.specialty), specialtyAr: ar(d.specialty),
        photo: d.photo, bio: en(d.bio), bioAr: ar(d.bio),
        department: d.department,
        certified: !!d.certified, featured: !!d.featured,
        order: d.order ?? undefined,
      }),
      body: '',
    }),
    toData: (fm, _b, slug) => ({
      ar: omitEmpty({
        slug, name: fm.nameAr, specialty: fm.specialtyAr, bio: fm.bioAr,
        photo: fm.photo, department: fm.department,
        certified: !!fm.certified, featured: !!fm.featured, order: fm.order,
      }),
      en: { name: fm.name, specialty: fm.specialty, bio: fm.bio ?? '' },
    }),
  },
  {
    collection: 'departments',
    dir: 'departments',
    toFile: (d) => ({
      slug: d.slug,
      frontmatter: omitEmpty({
        name: en(d.name), nameAr: ar(d.name),
        description: en(d.description), descriptionAr: ar(d.description),
        icon: d.icon, centerOfExcellence: !!d.centerOfExcellence,
      }),
      body: '',
    }),
    toData: (fm, _b, slug) => ({
      ar: omitEmpty({
        slug, name: fm.nameAr, description: fm.descriptionAr,
        icon: fm.icon, centerOfExcellence: !!fm.centerOfExcellence,
      }),
      en: { name: fm.name, description: fm.description },
    }),
  },
  {
    collection: 'articles',
    dir: 'articles',
    toFile: (d) => ({
      slug: d.slug,
      frontmatter: omitEmpty({
        title: en(d.title), titleAr: ar(d.title),
        date: ymd(d.date), author: d.author, category: d.category,
        thumbnail: d.thumbnail, featured: !!d.featured,
      }),
      body: d.body || '',
    }),
    toData: (fm, body, slug) => ({
      ar: omitEmpty({
        slug, title: fm.titleAr, date: new Date(fm.date).toISOString(),
        author: fm.author, category: fm.category, thumbnail: fm.thumbnail,
        featured: !!fm.featured, body,
      }),
      en: { title: fm.title },
    }),
  },
  {
    collection: 'events',
    dir: 'events',
    toFile: (d) => ({
      slug: d.slug,
      frontmatter: omitEmpty({
        title: en(d.title), titleAr: ar(d.title),
        summary: en(d.summary), summaryAr: ar(d.summary),
        date: ymd(d.date), category: d.category,
        thumbnail: d.thumbnail, featured: !!d.featured,
        youtubeUrl: d.youtubeUrl,
        gallery: (d.gallery || []).length
          ? d.gallery.map((g: any) => omitEmpty({ url: g.url, caption: en(g.caption), captionAr: ar(g.caption), alt: g.alt }))
          : undefined,
      }),
      body: d.body || '',
    }),
    toData: (fm, body, slug) => ({
      ar: omitEmpty({
        slug, title: fm.titleAr, summary: fm.summaryAr,
        date: new Date(fm.date).toISOString(), category: fm.category,
        thumbnail: fm.thumbnail, featured: !!fm.featured, youtubeUrl: fm.youtubeUrl,
        // ponytail: gallery captions seeded from AR; EN captions filled on the en update below.
        gallery: (fm.gallery || []).map((g: any) => omitEmpty({ url: g.url, caption: g.captionAr, alt: g.alt })),
        body,
      }),
      en: {
        title: fm.title, summary: fm.summary,
        gallery: (fm.gallery || []).map((g: any) => omitEmpty({ url: g.url, caption: g.caption, alt: g.alt })),
      },
    }),
  },
  {
    collection: 'awards',
    dir: 'awards',
    toFile: (d) => ({
      slug: d.slug,
      frontmatter: omitEmpty({
        name: en(d.name), nameAr: ar(d.name),
        body: en(d.body), year: d.year, badgeImage: d.badgeImage,
      }),
      body: '',
    }),
    toData: (fm, _b, slug) => ({
      ar: omitEmpty({ slug, name: fm.nameAr, body: fm.body, year: fm.year, badgeImage: fm.badgeImage }),
      en: { name: fm.name, body: fm.body },
    }),
  },
  {
    collection: 'achievements',
    dir: 'achievements',
    toFile: (d) => ({
      slug: d.slug,
      frontmatter: omitEmpty({
        year: d.year, title: en(d.title), titleAr: ar(d.title),
        description: en(d.description), descriptionAr: ar(d.description), icon: d.icon,
      }),
      body: '',
    }),
    toData: (fm, _b, slug) => ({
      ar: omitEmpty({ slug, year: fm.year, title: fm.titleAr, description: fm.descriptionAr, icon: fm.icon }),
      en: { title: fm.title, description: fm.description },
    }),
  },
  {
    collection: 'testimonials',
    dir: 'testimonials',
    toFile: (d) => ({
      slug: d.slug,
      frontmatter: omitEmpty({
        name: en(d.name), nameAr: ar(d.name),
        quote: en(d.quote), quoteAr: ar(d.quote),
        caseType: en(d.caseType), caseTypeAr: ar(d.caseType),
        avatar: d.avatar, featured: !!d.featured,
      }),
      body: '',
    }),
    toData: (fm, _b, slug) => ({
      ar: omitEmpty({
        slug, name: fm.nameAr, quote: fm.quoteAr, caseType: fm.caseTypeAr,
        avatar: fm.avatar, featured: !!fm.featured,
      }),
      en: omitEmpty({ name: fm.name, quote: fm.quote, caseType: fm.caseType }),
    }),
  },
]

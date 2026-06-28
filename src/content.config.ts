import { defineCollection } from "astro:content";
import { z } from "zod";

const CMS = import.meta.env.CMS_URL ?? "http://localhost:3000";

// Payload returns localized fields as { en, ar } when ?locale=all
// Non-localized fields sometimes get the same treatment — handle both
function loc(f: any): [string, string] {
  if (f && typeof f === "object") return [f.en ?? "", f.ar ?? ""];
  return [String(f ?? ""), ""];
}

function num(f: any): number | undefined {
  if (f == null) return undefined;
  const v = typeof f === "object" ? (f.en ?? f.ar) : f;
  return v == null ? undefined : Number(v);
}

function str(f: any): string | undefined {
  if (f == null) return undefined;
  const v = typeof f === "object" ? (f.en ?? f.ar) : f;
  return v == null ? undefined : String(v);
}

async function fetchDocs(slug: string) {
  const url = `${CMS}/api/${slug}?locale=all&depth=1&limit=1000`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Cannot reach Payload CMS at ${url} — is it running? (${e})`);
  }
  if (!res.ok) throw new Error(`Payload /${slug} returned ${res.status}: ${await res.text()}`);
  return (await res.json()).docs as any[];
}

const articles = defineCollection({
  loader: async () => {
    const docs = await fetchDocs("articles");
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      return { id: doc.slug, title, titleAr, date: new Date(doc.date), author: str(doc.author), category: doc.category, thumbnail: str(doc.thumbnail), featured: doc.featured ?? false, body: doc.body };
    });
  },
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    date: z.coerce.date(),
    author: z.string(),
    category: z.enum(["hospital-news", "health-tips", "research", "events"]),
    thumbnail: z.string(),
    featured: z.boolean().default(false),
    body: z.string().optional(),
  }),
});

const achievements = defineCollection({
  loader: async () => {
    const docs = await fetchDocs("achievements");
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      const [description, descriptionAr] = loc(doc.description);
      return { id: doc.slug, year: num(doc.year)!, title, titleAr, description, descriptionAr, icon: str(doc.icon) };
    });
  },
  schema: z.object({
    year: z.number(),
    title: z.string(),
    titleAr: z.string(),
    description: z.string(),
    descriptionAr: z.string(),
    icon: z.string().optional(),
  }),
});

const awards = defineCollection({
  loader: async () => {
    const docs = await fetchDocs("awards");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [body] = loc(doc.body);
      return { id: doc.slug, name, nameAr, body, year: num(doc.year)!, badgeImage: str(doc.badgeImage) };
    });
  },
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    body: z.string(),
    year: z.number(),
    badgeImage: z.string().optional(),
  }),
});

const departments = defineCollection({
  loader: async () => {
    const docs = await fetchDocs("departments");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [description, descriptionAr] = loc(doc.description);
      return { id: doc.slug, name, nameAr, description, descriptionAr, icon: str(doc.icon), centerOfExcellence: doc.centerOfExcellence ?? false };
    });
  },
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    description: z.string(),
    descriptionAr: z.string(),
    icon: z.string(),
    centerOfExcellence: z.boolean().default(false),
  }),
});

const doctors = defineCollection({
  loader: async () => {
    const docs = await fetchDocs("doctors");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [specialty, specialtyAr] = loc(doc.specialty);
      const [bio, bioAr] = loc(doc.bio);
      return { id: doc.slug, name, nameAr, specialty, specialtyAr, photo: str(doc.photo), bio, bioAr, department: str(doc.department), certified: doc.certified ?? false, featured: doc.featured ?? false, order: num(doc.order) };
    });
  },
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    specialty: z.string(),
    specialtyAr: z.string(),
    photo: z.string(),
    bio: z.string(),
    bioAr: z.string(),
    department: z.string().optional(),
    certified: z.boolean().default(false),
    featured: z.boolean().default(false),
    order: z.number().optional(),
  }),
});

const events = defineCollection({
  loader: async () => {
    const docs = await fetchDocs("events");
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      const [summary, summaryAr] = loc(doc.summary);
      const gallery = doc.gallery?.map((g: any) => {
        const [caption, captionAr] = loc(g.caption);
        const [alt] = loc(g.alt);
        return { url: g.url, caption: caption || undefined, captionAr: captionAr || undefined, alt };
      });
      return { id: doc.slug, title, titleAr, date: new Date(doc.date), category: doc.category, summary, summaryAr, thumbnail: str(doc.thumbnail), featured: doc.featured ?? false, youtubeUrl: str(doc.youtubeUrl), gallery, body: doc.body };
    });
  },
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    date: z.coerce.date(),
    category: z.enum(["procedure", "event", "announcement"]),
    summary: z.string(),
    summaryAr: z.string(),
    thumbnail: z.string().optional(),
    featured: z.boolean().default(false),
    youtubeUrl: z.string().url().optional(),
    gallery: z.array(z.object({
      url: z.string(),
      caption: z.string().optional(),
      captionAr: z.string().optional(),
      alt: z.string(),
    })).optional(),
    body: z.string().optional(),
    bodyAr: z.string().optional(),
  }),
});

const testimonials = defineCollection({
  loader: async () => {
    const docs = await fetchDocs("testimonials");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [quote, quoteAr] = loc(doc.quote);
      const [caseType, caseTypeAr] = loc(doc.caseType);
      return { id: doc.slug, name, nameAr, quote, quoteAr, caseType: caseType || undefined, caseTypeAr: caseTypeAr || undefined, avatar: str(doc.avatar), featured: doc.featured ?? false };
    });
  },
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    quote: z.string(),
    quoteAr: z.string(),
    caseType: z.string().optional(),
    caseTypeAr: z.string().optional(),
    avatar: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});

export const collections = {
  articles,
  achievements,
  awards,
  departments,
  doctors,
  events,
  testimonials,
};

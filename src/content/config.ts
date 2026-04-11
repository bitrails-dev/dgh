import { defineCollection, z } from "astro:content";

const articles = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    date: z.date(),
    author: z.string(),
    category: z.enum(["hospital-news", "health-tips", "research", "events"]),
    thumbnail: z.string(),
    featured: z.boolean().default(false),
    lang: z.enum(["ar", "en"]).default("ar"),
  }),
});

const achievements = defineCollection({
  type: "content",
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
  type: "content",
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    body: z.string(),
    year: z.number(),
    badgeImage: z.string().optional(),
  }),
});

const departments = defineCollection({
  type: "content",
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
  type: "content",
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    specialty: z.string(),
    specialtyAr: z.string(),
    photo: z.string(),
    bio: z.string(),
    bioAr: z.string(),
    certified: z.boolean().default(false),
    featured: z.boolean().default(false),
  }),
});

const news = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    excerpt: z.string(),
    excerptAr: z.string(),
    date: z.date(),
    category: z.enum(["hospital-news", "health-tips", "research", "events"]),
    thumbnail: z.string(),
    featured: z.boolean().default(false),
    lang: z.enum(["ar", "en"]).default("ar"),
  }),
});

export const collections = {
  articles,
  achievements,
  awards,
  departments,
  doctors,
  news,
};

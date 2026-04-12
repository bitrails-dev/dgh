import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "zod/v4";

const articles = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/articles" }),
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    date: z.coerce.date(),
    author: z.string(),
    category: z.enum(["hospital-news", "health-tips", "research", "events"]),
    thumbnail: z.string(),
    featured: z.boolean().default(false),
    lang: z.enum(["ar", "en"]).default("ar"),
  }),
});

const achievements = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/achievements" }),
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
  loader: glob({ pattern: "**/*.md", base: "./src/content/awards" }),
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    body: z.string(),
    year: z.number(),
    badgeImage: z.string().optional(),
  }),
});

const departments = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/departments" }),
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
  loader: glob({ pattern: "**/*.md", base: "./src/content/doctors" }),
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
  }),
});

const news = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/news" }),
  schema: z.object({
    title: z.string(),
    titleAr: z.string(),
    excerpt: z.string(),
    excerptAr: z.string(),
    date: z.coerce.date(),
    category: z.enum(["hospital-news", "health-tips", "research", "events"]),
    thumbnail: z.string(),
    featured: z.boolean().default(false),
    lang: z.enum(["ar", "en"]).default("ar"),
  }),
});

const nursing = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/nursing" }),
  schema: z.object({
    name: z.string(),
    nameAr: z.string(),
    role: z.string(),
    roleAr: z.string(),
    department: z.string().optional(),
    featured: z.boolean().default(false),
  }),
});

export const collections = {
  articles,
  achievements,
  awards,
  departments,
  doctors,
  news,
  nursing,
};

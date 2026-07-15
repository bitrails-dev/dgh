// ponytail: drop-in replacement for getCollection() that fetches live per-request
// instead of the content layer cache in .astro/ (which only updates on server restart)
import { normalizeBlocks } from "./blocks";

const CMS = import.meta.env.CMS_URL ?? "http://localhost:3000";

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
function imgUrl(f: any): string | undefined {
  if (f == null) return undefined;
  const raw = typeof f === "string" ? f : (f.url ?? undefined);
  if (!raw) return undefined;
  return raw.startsWith("/") ? `${CMS}${raw}` : raw;
}
// Relationship field at depth=1 is the related doc; pull a scalar (e.g. slug) off it.
function rel(f: any, key = "slug"): string | undefined {
  if (f == null) return undefined;
  if (typeof f === "object") return f[key] != null ? String(f[key]) : undefined;
  return String(f);
}

type TenantId = string | number | undefined;

// Multi-tenant: unauthenticated REST reads are NOT auto-filtered by the multi-tenant plugin, so
// the tenant constraint is passed explicitly. When tenantId is undefined (unresolved tenant /
// single-tenant deploy), no filter is applied and all docs are returned (pre-tenant behavior).
async function fetchDocs(slug: string, tenantId?: TenantId) {
  const filter = tenantId != null ? `&where[tenant][equals]=${encodeURIComponent(String(tenantId))}` : "";
  const url = `${CMS}/api/${slug}?locale=all&depth=1&limit=1000${filter}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Cannot reach Payload CMS at ${url} — is it running? (${e})`);
  }
  if (!res.ok) throw new Error(`Payload /${slug} returned ${res.status}: ${await res.text()}`);
  return (await res.json()).docs as any[];
}

const mappers = {
  articles: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("articles", tenantId);
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      const cat = doc.categoryRel;
      let category, categoryName, categoryNameAr, categoryColor;
      if (cat && typeof cat === "object") {
        const [n, nAr] = loc(cat.name);
        category = cat.slug; categoryName = n; categoryNameAr = nAr; categoryColor = cat.color;
      }
      return { id: doc.slug, data: { title, titleAr, date: new Date(doc.date), author: str(doc.author), category, categoryName, categoryNameAr, categoryColor, thumbnail: imgUrl(doc.thumbnail), featured: doc.featured ?? false, content: normalizeBlocks(doc.content) } };
    });
  },
  achievements: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("achievements", tenantId);
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      const [description, descriptionAr] = loc(doc.description);
      return { id: doc.slug, data: { year: num(doc.year)!, title, titleAr, description, descriptionAr, icon: str(doc.icon) } };
    });
  },
  awards: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("awards", tenantId);
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [body] = loc(doc.body);
      return { id: doc.slug, data: { name, nameAr, body, year: num(doc.year)!, badgeImage: imgUrl(doc.badgeImage) } };
    });
  },
  departments: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("departments", tenantId);
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [description, descriptionAr] = loc(doc.description);
      return { id: doc.slug, data: { name, nameAr, description, descriptionAr, icon: str(doc.icon), iconUrl: imgUrl(doc.iconRef), centerOfExcellence: doc.centerOfExcellence ?? false } };
    });
  },
  doctors: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("doctors", tenantId);
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [specialty, specialtyAr] = loc(doc.specialty);
      const [bio, bioAr] = loc(doc.bio);
      return { id: doc.slug, data: { name, nameAr, specialty, specialtyAr, photo: imgUrl(doc.photo), bio, bioAr, department: rel(doc.departmentRel) ?? str(doc.department), certified: doc.certified ?? false, featured: doc.featured ?? false, order: num(doc.order) } };
    });
  },
  events: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("events", tenantId);
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      const [summary, summaryAr] = loc(doc.summary);
      const gallery = doc.gallery?.map((g: any) => {
        const [caption, captionAr] = loc(g.caption);
        const [alt] = loc(g.alt);
        return { url: imgUrl(g.image), caption: caption || undefined, captionAr: captionAr || undefined, alt };
      });
      return { id: doc.slug, data: { title, titleAr, date: new Date(doc.date), category: doc.category, summary, summaryAr, thumbnail: imgUrl(doc.thumbnail), featured: doc.featured ?? false, youtubeUrl: str(doc.youtubeUrl), gallery, body: doc.body } };
    });
  },
  testimonials: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("testimonials", tenantId);
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [quote, quoteAr] = loc(doc.quote);
      const [caseType, caseTypeAr] = loc(doc.caseType);
      return { id: doc.slug, data: { name, nameAr, quote, quoteAr, caseType: caseType || undefined, caseTypeAr: caseTypeAr || undefined, avatar: imgUrl(doc.avatar), featured: doc.featured ?? false } };
    });
  },
  categories: async (tenantId?: TenantId) => {
    const docs = await fetchDocs("categories", tenantId);
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      return { id: doc.slug, data: { name, nameAr, color: str(doc.color) } };
    });
  },
};

export async function getCollection(name: keyof typeof mappers, tenantId?: TenantId) {
  return mappers[name](tenantId);
}

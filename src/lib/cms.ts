// ponytail: drop-in replacement for getCollection() that fetches live per-request
// instead of the content layer cache in .astro/ (which only updates on server restart)
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

const mappers = {
  articles: async () => {
    const docs = await fetchDocs("articles");
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      return { id: doc.slug, data: { title, titleAr, date: new Date(doc.date), author: str(doc.author), category: doc.category, thumbnail: imgUrl(doc.thumbnail), featured: doc.featured ?? false, body: doc.body } };
    });
  },
  achievements: async () => {
    const docs = await fetchDocs("achievements");
    return docs.map((doc) => {
      const [title, titleAr] = loc(doc.title);
      const [description, descriptionAr] = loc(doc.description);
      return { id: doc.slug, data: { year: num(doc.year)!, title, titleAr, description, descriptionAr, icon: str(doc.icon) } };
    });
  },
  awards: async () => {
    const docs = await fetchDocs("awards");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [body] = loc(doc.body);
      return { id: doc.slug, data: { name, nameAr, body, year: num(doc.year)!, badgeImage: imgUrl(doc.badgeImage) } };
    });
  },
  departments: async () => {
    const docs = await fetchDocs("departments");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [description, descriptionAr] = loc(doc.description);
      return { id: doc.slug, data: { name, nameAr, description, descriptionAr, icon: str(doc.icon), centerOfExcellence: doc.centerOfExcellence ?? false } };
    });
  },
  doctors: async () => {
    const docs = await fetchDocs("doctors");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [specialty, specialtyAr] = loc(doc.specialty);
      const [bio, bioAr] = loc(doc.bio);
      return { id: doc.slug, data: { name, nameAr, specialty, specialtyAr, photo: imgUrl(doc.photo), bio, bioAr, department: str(doc.department), certified: doc.certified ?? false, featured: doc.featured ?? false, order: num(doc.order) } };
    });
  },
  events: async () => {
    const docs = await fetchDocs("events");
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
  testimonials: async () => {
    const docs = await fetchDocs("testimonials");
    return docs.map((doc) => {
      const [name, nameAr] = loc(doc.name);
      const [quote, quoteAr] = loc(doc.quote);
      const [caseType, caseTypeAr] = loc(doc.caseType);
      return { id: doc.slug, data: { name, nameAr, quote, quoteAr, caseType: caseType || undefined, caseTypeAr: caseTypeAr || undefined, avatar: imgUrl(doc.avatar), featured: doc.featured ?? false } };
    });
  },
};

export async function getCollection(name: keyof typeof mappers) {
  return mappers[name]();
}

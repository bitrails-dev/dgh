// Normalizes Payload's article `content` blocks (fetched with ?locale=all&depth=1) into a flat,
// render-ready shape. Block structure is shared across locales; text fields inside are localized,
// so each localized field is split into `x` (en) / `xAr` (ar). Rich text is pre-rendered to HTML.
import { lexicalToHtml } from "./lexical";

const CMS = import.meta.env.CMS_URL ?? "http://localhost:3000";

function abs(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw.startsWith("/") ? `${CMS}${raw}` : raw;
}
function uploadUrl(f: any): string | undefined {
  if (f == null) return undefined;
  return abs(typeof f === "string" ? f : f.url);
}
// Localized field at ?locale=all is { en, ar }; non-localized comes through raw.
function pick(f: any): [any, any] {
  if (f && typeof f === "object" && ("en" in f || "ar" in f)) return [f.en, f.ar];
  return [f, f];
}

export type ArticleBlock =
  | { type: "richText"; html: string; htmlAr: string }
  | { type: "heading"; level: string; text: string; textAr: string }
  | { type: "image"; url?: string; alt: string; altAr: string; caption?: string; captionAr?: string }
  | { type: "youtube"; url: string; caption?: string; captionAr?: string }
  | { type: "testimonial"; url?: string; text: string; textAr: string; caption?: string; captionAr?: string };

export function normalizeBlocks(raw: any): ArticleBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: ArticleBlock[] = [];
  for (const b of raw) {
    switch (b?.blockType) {
      case "richText": {
        const [en, ar] = pick(b.richText);
        out.push({ type: "richText", html: lexicalToHtml(en), htmlAr: lexicalToHtml(ar ?? en) });
        break;
      }
      case "heading": {
        const [en, ar] = pick(b.text);
        out.push({ type: "heading", level: b.level ?? "h2", text: String(en ?? ""), textAr: String(ar ?? en ?? "") });
        break;
      }
      case "image": {
        const [alt, altAr] = pick(b.alt);
        const [cap, capAr] = pick(b.caption);
        out.push({ type: "image", url: uploadUrl(b.image), alt: String(alt ?? ""), altAr: String(altAr ?? alt ?? ""), caption: cap || undefined, captionAr: capAr || undefined });
        break;
      }
      case "youtube": {
        const [cap, capAr] = pick(b.caption);
        if (b.url) out.push({ type: "youtube", url: String(b.url), caption: cap || undefined, captionAr: capAr || undefined });
        break;
      }
      case "testimonial": {
        const [text, textAr] = pick(b.text);
        const [cap, capAr] = pick(b.caption);
        out.push({ type: "testimonial", url: uploadUrl(b.image), text: String(text ?? ""), textAr: String(textAr ?? text ?? ""), caption: cap || undefined, captionAr: capAr || undefined });
        break;
      }
    }
  }
  return out;
}

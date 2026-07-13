// Per-request tenant resolution. The site is multi-tenant: one deployment serves many
// hospitals/clinics, resolved by request host (or the TENANT_SLUG env override for a
// single-tenant deploy / dev). Content is then filtered by tenant.id and the public surface
// (nav, sections, routes) is gated by tenant.features. See src/middleware.ts for the wiring.

const CMS = import.meta.env.CMS_URL ?? "http://localhost:3000";

export type TenantFeature =
  | "departments" | "team" | "articles" | "events"
  | "awards" | "achievements" | "testimonials" | "portal";

export interface Tenant {
  id: number | string;
  slug: string;
  type: "hospital" | "clinic";
  name: string; nameAr: string;
  domains: string[];
  features: TenantFeature[];
  initials?: string;
  tagline?: string; taglineAr?: string;
  established?: string; establishedAr?: string;
  logo?: string;
  themeColor?: string;
  contact: {
    phone?: string; emergencyNumber?: string; whatsapp?: string; email?: string;
    address?: string; addressAr?: string;
    social?: { facebookUrl?: string; xUrl?: string; youtubeUrl?: string };
    hours?: Array<{ day: string; dayAr: string; time: string; timeAr: string }>;
  };
  hero?: Record<string, { value?: string; valueAr?: string; unit?: string; unitAr?: string }>;
}

function loc(f: any): [string, string] {
  if (f && typeof f === "object" && !Array.isArray(f)) return [f.en ?? "", f.ar ?? ""];
  return [String(f ?? ""), ""];
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

function normalize(doc: any): Tenant {
  const [name, nameAr] = loc(doc.name);
  const [tagline, taglineAr] = loc(doc.branding?.tagline);
  const [established, establishedAr] = loc(doc.branding?.established);
  const c = doc.contact ?? {};
  const [address, addressAr] = loc(c.address);
  return {
    id: doc.id,
    slug: str(doc.slug) ?? "",
    type: (str(doc.type) as Tenant["type"]) ?? "hospital",
    name, nameAr,
    // hasMany text comes back as an array under locale=all it may be wrapped; keep it simple.
    domains: Array.isArray(doc.domains) ? doc.domains.map(String) : [],
    features: Array.isArray(doc.features) ? (doc.features as TenantFeature[]) : [],
    initials: str(doc.branding?.initials),
    tagline: tagline || undefined, taglineAr: taglineAr || undefined,
    established: established || undefined, establishedAr: establishedAr || undefined,
    logo: imgUrl(doc.branding?.logo),
    themeColor: str(doc.branding?.themeColor),
    contact: {
      phone: str(c.phone), emergencyNumber: str(c.emergencyNumber),
      whatsapp: str(c.whatsapp), email: str(c.email),
      address: address || undefined, addressAr: addressAr || undefined,
      social: {
        facebookUrl: str(c.social?.facebookUrl),
        xUrl: str(c.social?.xUrl),
        youtubeUrl: str(c.social?.youtubeUrl),
      },
      hours: Array.isArray(c.hours) ? c.hours.map((h: any) => {
        const [day, dayAr] = loc(h.day); const [time, timeAr] = loc(h.time);
        return { day, dayAr, time, timeAr };
      }) : [],
    },
    hero: doc.hero ?? undefined,
  };
}

// ponytail: 60s TTL cache of the whole (small) tenant list. Tenants change rarely; content does not
// flow through here. Bump/clear by restarting the server, same as the rest of the live CMS reads.
let cache: { at: number; tenants: Tenant[] } | null = null;
const TTL = 60_000;

async function loadTenants(): Promise<Tenant[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.tenants;
  const url = `${CMS}/api/tenants?locale=all&depth=1&limit=100`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const tenants = ((await res.json()).docs as any[]).map(normalize);
    cache = { at: Date.now(), tenants };
    return tenants;
  } catch (e) {
    // Degrade gracefully: no tenant resolved → callers fall back to unfiltered content + i18n
    // branding (i.e. behaves like the pre-tenant single-hospital site).
    console.warn(`[tenant] could not load tenants from ${url}: ${e}`);
    return cache?.tenants ?? [];
  }
}

const TENANT_SLUG = import.meta.env.TENANT_SLUG ?? (typeof process !== "undefined" ? process.env?.TENANT_SLUG : undefined);

export async function resolveTenant(host: string): Promise<Tenant | undefined> {
  const tenants = await loadTenants();
  if (tenants.length === 0) return undefined;
  if (TENANT_SLUG) return tenants.find((t) => t.slug === TENANT_SLUG);
  const h = host.toLowerCase().replace(/:\d+$/, "");
  const byDomain = tenants.find((t) => t.domains.some((d) => d.toLowerCase() === h));
  if (byDomain) return byDomain;
  // Single-tenant deploy with no domain configured → serve the only tenant.
  return tenants.length === 1 ? tenants[0] : undefined;
}

export function hasFeature(tenant: Tenant | undefined, feature: TenantFeature): boolean {
  return tenant ? tenant.features.includes(feature) : false;
}

// Overlay the resolved tenant's identity/contact onto the i18n `strings` so the shared chrome
// (top bar, footer, sidebar, contact) is tenant-driven, falling back to the i18n defaults for any
// value the tenant leaves blank. Returns `strings` untouched when no tenant is resolved.
// ponytail: per-page <title> and BaseLayout JSON-LD are handled separately; this covers the chrome.
export function applyTenant(strings: any, tenant: Tenant | undefined, lang: "ar" | "en"): any {
  if (!tenant) return strings;
  const ar = lang === "ar";
  const c = tenant.contact;
  const hours = (c.hours ?? []).map((h) => ({ day: ar ? h.dayAr : h.day, time: ar ? h.timeAr : h.time }));
  return {
    ...strings,
    site: {
      ...strings.site,
      name: (ar ? tenant.nameAr : tenant.name) || strings.site?.name,
      established: (ar ? tenant.establishedAr : tenant.established) || strings.site?.established,
      tagline: (ar ? tenant.taglineAr : tenant.tagline) || strings.site?.tagline,
      initials: tenant.initials || strings.site?.initials,
    },
    contact: {
      ...strings.contact,
      details: {
        ...strings.contact?.details,
        address: (ar ? c.addressAr : c.address) || strings.contact?.details?.address,
        phone: c.phone || strings.contact?.details?.phone,
        emergencyNumber: c.emergencyNumber || strings.contact?.details?.emergencyNumber,
        whatsapp: c.whatsapp || strings.contact?.details?.whatsapp,
        email: c.email || strings.contact?.details?.email,
        hours: hours.length ? hours : strings.contact?.details?.hours,
      },
    },
  };
}

// Gate a route: 404 only when a tenant is resolved AND lacks the feature. When no tenant is
// resolved (single-tenant / unseeded), never gate — the site behaves as before.
export function routeGated(tenant: Tenant | undefined, feature: TenantFeature): boolean {
  return !!tenant && !tenant.features.includes(feature);
}

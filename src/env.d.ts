/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_PORTAL_API_BASE?: string;
  readonly CMS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

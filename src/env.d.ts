/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_PORTAL_API_BASE?: string;
  readonly CMS_URL?: string;
  readonly TENANT_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    tenant?: import("./lib/tenant").Tenant;
  }
}

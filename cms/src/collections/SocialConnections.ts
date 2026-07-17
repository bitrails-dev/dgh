import type { CollectionConfig, FieldAccess } from 'payload'
import type { Platform } from '../social/types'
import { PLATFORM_SELECT_OPTIONS } from '../social/platforms'
import { getUserTenantIDs, isSuperAdmin, isTenantAdmin, isUserManager } from '../access/userAccess'
import type { UserLike } from '../access/userAccess'

// Per-tenant OAuth connection to a social platform (Task D/E). Visible in the admin nav to managers
// (super-admin + tenant admin) and scoped to each admin's own tenants. Direct create is denied —
// connections are established only by the OAuth connect flow (Local API, overrideAccess); removal is
// the Disconnect endpoint (which also revokes at the provider). A tenant admin MAY edit the display
// fields of their own connections (label, status); secret + internal fields are locked at the field
// level so the encrypted token is never shown or writable through the UI / public API.
//
// `encryptedTokens` stores ONLY the crypto.encryptToken() base64 blob (IV+tag+ciphertext) — the
// plaintext token never lives at rest and is never returned to clients/logs. Internal readers (OAuth
// endpoints, publish job) read it via Local API with overrideAccess, which bypasses field access.

// Read/update scope: super-admin sees/edits all; a tenant admin only their own tenants' connections;
// everyone else (anonymous + editors) is denied. A Where constraint scopes BOTH the list and by-ID
// fetches, so a tenant admin cannot reach another tenant's connection by guessing its id.
const scopedAccess = (user: UserLike | null | undefined): boolean | { tenant: { in: string[] } } => {
  if (!user) return false
  if (isSuperAdmin(user)) return true
  if (!isTenantAdmin(user)) return false
  const ids = getUserTenantIDs(user)
  return ids.length ? { tenant: { in: ids } } : false
}

const superAdminOnly: FieldAccess = ({ req }) => isSuperAdmin(req.user)

export const SocialConnections: CollectionConfig = {
  slug: 'social-connections',
  labels: {
    singular: { ar: 'اتصال تواصل اجتماعي', en: 'Social connection' },
    plural: { ar: 'اتصالات التواصل الاجتماعي', en: 'Social connections' },
  },
  admin: {
    // Visible in the admin nav to super-admins and tenant admins only. The token blob is never
    // exposed (field-level lock + hidden below) and rows are scoped to the admin's own tenants.
    hidden: ({ user }) => !isUserManager(user as UserLike | null),
    useAsTitle: 'platform',
    defaultColumns: ['platform', 'remoteAccountLabel', 'status', 'lastPublishStatus'],
    group: { ar: 'الإعدادات', en: 'Settings' },
  },
  access: {
    // Scoped to the connection's tenant (see scopedAccess). Internal mutation paths use overrideAccess.
    read: ({ req }) => scopedAccess(req.user as UserLike | null),
    // Created only via the OAuth connect flow — never by hand (there is no token to paste).
    create: () => false,
    // A tenant admin may edit display fields of their own connections; secret/internal fields are
    // field-locked below.
    update: ({ req }) => scopedAccess(req.user as UserLike | null),
    // Removal goes through the Disconnect endpoint, which also revokes at the provider. Direct delete
    // is denied to avoid orphaning a still-valid provider token.
    delete: () => false,
  },
  indexes: [
    { fields: ['tenant', 'platform', 'remoteAccountId'], unique: true },
  ],
  fields: [
    { name: 'tenant', type: 'relationship', relationTo: 'tenants', required: true, index: true,
      // Reassigning a connection to another tenant is super-admin-only.
      access: { update: superAdminOnly } },
    { name: 'platform', type: 'select', required: true, options: PLATFORM_SELECT_OPTIONS, index: true,
      admin: { readOnly: true } },
    { name: 'remoteAccountId', type: 'text', required: true,
      admin: { readOnly: true, description: 'Provider account id (FB Page id, IG account id, LinkedIn URN, YouTube channel id).' } },
    { name: 'remoteAccountLabel', type: 'text',
      admin: { description: 'Display name for the connected account (no tokens).' } },
    { name: 'status', type: 'select', defaultValue: 'connected', index: true,
      options: [
        { value: 'connected', label: 'Connected' },
        { value: 'reconnect_required', label: 'Reconnect required' },
        { value: 'error', label: 'Error' },
      ] },
    // Never shown or reachable through the admin UI / public API. Internal readers use overrideAccess.
    { name: 'encryptedTokens', type: 'textarea', required: true,
      access: { read: () => false, update: () => false },
      admin: { hidden: true, description: 'AES-256-GCM blob from crypto.encryptToken(). Ciphertext only.' } },
    { name: 'tokenExpiresAt', type: 'date', admin: { hidden: true } },
    { name: 'scope', type: 'text', admin: { hidden: true } },
    // Sanitized last-publish outcome surfaced in the connection panel (no tokens). Job-managed; read-only.
    { name: 'lastPublishStatus', type: 'select',
      options: [
        { value: 'published', label: 'Published' },
        { value: 'failed', label: 'Failed' },
        { value: 'skipped', label: 'Skipped' },
      ],
      admin: { readOnly: true } },
    { name: 'lastPublishAt', type: 'date', admin: { readOnly: true } },
    { name: 'lastPublishUrl', type: 'text', admin: { readOnly: true } },
    { name: 'lastErrorCode', type: 'text', admin: { readOnly: true } },
  ],
}

// Narrowing helper for the publish job/OAuth endpoints.
export type SocialConnection = {
  id: number | string
  tenant: number | string
  platform: Platform
  remoteAccountId: string
  status: 'connected' | 'reconnect_required' | 'error'
  encryptedTokens: string
  tokenExpiresAt?: string | null
}

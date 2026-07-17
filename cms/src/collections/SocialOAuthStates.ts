import type { CollectionConfig } from 'payload'
import { PLATFORM_SELECT_OPTIONS } from '../social/platforms'

// One-time OAuth state nonces (Task D/E). HIDDEN + direct-access locked. The connect flow stores a
// SHA-256 of the signed state's nonce with an expiry; the callback verifies the HMAC signature
// (crypto.verifyState) AND that the nonce hash exists + is not yet consumed, then marks it consumed.
// Prevents replay. Expired/consumed rows are cleaned up opportunistically.
export const SocialOAuthStates: CollectionConfig = {
  slug: 'social-oauth-states',
  labels: {
    singular: { en: 'OAuth state' },
    plural: { en: 'OAuth states' },
  },
  admin: { hidden: true },
  access: {
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'nonceHash', type: 'text', required: true, unique: true, index: true },
    { name: 'tenant', type: 'relationship', relationTo: 'tenants', required: true, index: true },
    { name: 'platform', type: 'select', required: true, options: PLATFORM_SELECT_OPTIONS },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'consumedAt', type: 'date' },
    // When populated, this row is a multi-account SELECTION SESSION (not an OAuth state): the connect
    // callback stores the candidate targets here (AES-encrypted) and redirects to /api/social/select.
    { name: 'encryptedCandidates', type: 'textarea',
      admin: { description: 'AES-256-GCM blob of candidate publish targets (multi-account selection).' } },
    { name: 'codeVerifier', type: 'text',
      admin: { description: 'OAuth 2.0 PKCE code_verifier for providers that require it (X). Server-side only.' } },
    { name: 'returnTo', type: 'text' },
  ],
}

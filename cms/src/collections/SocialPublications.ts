import type { CollectionConfig } from 'payload'
import { PLATFORM_SELECT_OPTIONS } from '../social/platforms'

// One publication record per Article + platform (Task D/E). HIDDEN + direct-access locked. The
// publish job is the sole writer; the connection panel reads sanitized status via a custom tenant
// endpoint. The unique [article, platform] index is the idempotency guarantee: the create-only
// Article trigger creates the pending row once; retries reuse the same row.
export const SocialPublications: CollectionConfig = {
  slug: 'social-publications',
  labels: {
    singular: { ar: 'سجل نشر', en: 'Publication' },
    plural: { ar: 'سجلات النشر', en: 'Publications' },
  },
  admin: { hidden: true, useAsTitle: 'platform' },
  access: {
    read: () => false,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  // Idempotency: at most one publication row per article + platform.
  indexes: [
    { fields: ['article', 'platform'], unique: true },
  ],
  fields: [
    { name: 'tenant', type: 'relationship', relationTo: 'tenants', required: true, index: true },
    { name: 'article', type: 'relationship', relationTo: 'articles', required: true, index: true },
    { name: 'platform', type: 'select', required: true, options: PLATFORM_SELECT_OPTIONS },
    { name: 'locale', type: 'text' },
    { name: 'status', type: 'select', required: true, defaultValue: 'pending', index: true,
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'processing', label: 'Processing' },
        { value: 'published', label: 'Published' },
        { value: 'failed', label: 'Failed' },
        { value: 'skipped', label: 'Skipped' },
      ] },
    { name: 'attempts', type: 'number', defaultValue: 0 },
    { name: 'payloadHash', type: 'text',
      admin: { description: 'SHA-256 of the PublishInput; detects content drift across retries.' } },
    { name: 'remoteId', type: 'text' },
    { name: 'remoteUrl', type: 'text' },
    // Sanitized only — never tokens or full provider responses.
    { name: 'errorCode', type: 'text' },
    { name: 'errorMessage', type: 'textarea' },
    { name: 'failureKind', type: 'select',
      options: [
        { value: 'transient', label: 'Transient (retryable)' },
        { value: 'permanent', label: 'Permanent (stop)' },
      ] },
    { name: 'skippedReason', type: 'text' },
  ],
}

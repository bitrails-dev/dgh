import type { CollectionConfig } from 'payload'

// Uploaded article videos. Separate from Media so the image-only `sharp` pipeline
// and `image/*` restriction don't apply, and so social auto-publishing can key off
// a dedicated video relation. Files land in ../public/uploads/videos and are served
// at /uploads/videos so the pull-from-URL social APIs (Facebook, TikTok, Instagram)
// can fetch them.
export const Videos: CollectionConfig = {
  slug: 'videos',
  labels: {
    singular: { ar: 'فيديو', en: 'Video' },
    plural: { ar: 'الفيديوهات', en: 'Videos' },
  },
  access: { read: () => true },
  upload: {
    staticDir: '../public/uploads/videos',
    staticURL: '/uploads/videos',
    mimeTypes: ['video/*'],
  },
  fields: [
    { name: 'alt', type: 'text', label: { ar: 'وصف بديل', en: 'Alt / description' } },
  ],
}

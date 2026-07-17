import type { Block, CollectionConfig } from 'payload'
import { defaultAutoPublishFromTenant, queueSocialPublish } from '../social/hook'

// Article body is composed of ordered blocks. Structure/order is shared across locales;
// text fields inside each block are localized (ar default + en).
const RichTextBlock: Block = {
  slug: 'richText',
  labels: { singular: { ar: 'نص', en: 'Rich Text' }, plural: { ar: 'نصوص', en: 'Rich Text' } },
  fields: [
    { name: 'richText', type: 'richText', localized: true,
      label: { ar: 'النص', en: 'Text' } },
  ],
}

const HeadingBlock: Block = {
  slug: 'heading',
  labels: { singular: { ar: 'عنوان', en: 'Heading' }, plural: { ar: 'عناوين', en: 'Headings' } },
  fields: [
    { name: 'text', type: 'text', required: true, localized: true,
      label: { ar: 'العنوان', en: 'Heading' } },
    { name: 'level', type: 'select', defaultValue: 'h2',
      label: { ar: 'المستوى', en: 'Level' },
      options: [
        { label: 'H2', value: 'h2' },
        { label: 'H3', value: 'h3' },
      ] },
  ],
}

const ImageBlock: Block = {
  slug: 'image',
  labels: { singular: { ar: 'صورة', en: 'Image' }, plural: { ar: 'صور', en: 'Images' } },
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media', required: true,
      label: { ar: 'الصورة', en: 'Image' } },
    { name: 'alt', type: 'text', localized: true,
      label: { ar: 'النص البديل', en: 'Alt text' } },
    { name: 'caption', type: 'text', localized: true,
      label: { ar: 'التعليق', en: 'Caption' } },
  ],
}

const YouTubeBlock: Block = {
  slug: 'youtube',
  labels: { singular: { ar: 'فيديو يوتيوب', en: 'YouTube Video' }, plural: { ar: 'فيديوهات يوتيوب', en: 'YouTube Videos' } },
  fields: [
    { name: 'url', type: 'text', required: true,
      label: { ar: 'رابط يوتيوب', en: 'YouTube URL' },
      admin: { description: 'Full watch/share URL — e.g. https://youtu.be/…' } },
    { name: 'caption', type: 'text', localized: true,
      label: { ar: 'التعليق', en: 'Caption' } },
  ],
}

const TestimonialBlock: Block = {
  slug: 'testimonial',
  labels: { singular: { ar: 'شهادة', en: 'Testimonial' }, plural: { ar: 'شهادات', en: 'Testimonials' } },
  fields: [
    { name: 'image', type: 'upload', relationTo: 'media',
      label: { ar: 'الصورة', en: 'Image' } },
    { name: 'text', type: 'textarea', required: true, localized: true,
      label: { ar: 'النص', en: 'Text' } },
    { name: 'caption', type: 'text', localized: true,
      label: { ar: 'التعليق', en: 'Caption' },
      admin: { description: 'Attribution — name / role' } },
  ],
}

export const Articles: CollectionConfig = {
  slug: 'articles',
  labels: {
    singular: { ar: 'مقال', en: 'Article' },
    plural: { ar: 'المقالات', en: 'Articles' },
  },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'date', 'categoryRel', 'featured'] },
  access: { read: () => true },
  hooks: {
    // `autoPublish` defaults from the tenant on create when omitted; the afterChange hook fans out
    // the social publish (create-only, non-blocking, fully isolated — never affects the save).
    beforeChange: [defaultAutoPublishFromTenant],
    afterChange: [queueSocialPublish],
  },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'title', type: 'text', required: true, localized: true,
      label: { ar: 'العنوان', en: 'Title' } },
    { name: 'date', type: 'date', required: true,
      label: { ar: 'التاريخ', en: 'Date' } },
    { name: 'author', type: 'text', required: true,
      label: { ar: 'الكاتب', en: 'Author' } },
    // Editable category from the Categories collection. Optional so a category can be cleared
    // when its category is deleted (see the reassign-on-delete flow).
    { name: 'categoryRel', type: 'relationship', relationTo: 'categories',
      label: { ar: 'التصنيف', en: 'Category' } },
    { name: 'thumbnail', type: 'upload', relationTo: 'media',
      label: { ar: 'الصورة المصغّرة', en: 'Thumbnail' } },
    { name: 'featured', type: 'checkbox', defaultValue: false,
      label: { ar: 'مميّز', en: 'Featured' } },
    // Per-article opt-in to social auto-publish. Defaults (on create) from the tenant's
    // socialPublishing.defaultAutoPublish; explicit false is preserved.
    { name: 'autoPublish', type: 'checkbox',
      label: { ar: 'النشر التلقائي', en: 'Auto-publish to social' } },
    // Composable body. Shared structure across locales; text inside blocks is localized.
    { name: 'content', type: 'blocks',
      label: { ar: 'المحتوى', en: 'Content' },
      blocks: [RichTextBlock, HeadingBlock, ImageBlock, YouTubeBlock, TestimonialBlock] },
  ],
}

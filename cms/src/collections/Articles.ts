import type { Block, CollectionConfig } from 'payload'
import { publishArticleSocial } from '../social/hook'

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
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'date', 'category', 'featured'] },
  access: { read: () => true },
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
    // ponytail: legacy fixed enum kept read-only during transition so filtering never breaks.
    // The reader prefers `categoryRel` and falls back to this. Drop in a later cleanup migration.
    { name: 'category', type: 'select',
      label: { ar: 'التصنيف (قديم)', en: 'Category (legacy)' },
      admin: { readOnly: true, description: 'Legacy fixed category — superseded by the Categories collection.' },
      options: [
        { label: { ar: 'أخبار المستشفى', en: 'Hospital News' }, value: 'hospital-news' },
        { label: { ar: 'نصائح صحية', en: 'Health Tips' }, value: 'health-tips' },
        { label: { ar: 'أبحاث', en: 'Research' }, value: 'research' },
        { label: { ar: 'فعاليات', en: 'Events' }, value: 'events' },
      ] },
    { name: 'thumbnail', type: 'upload', relationTo: 'media',
      label: { ar: 'الصورة المصغّرة', en: 'Thumbnail' } },
    // Optional article video. When present it is auto-published on save to YouTube,
    // TikTok, Instagram Reels and Facebook (see the `social` group below).
    { name: 'video', type: 'upload', relationTo: 'videos',
      label: { ar: 'الفيديو', en: 'Video' },
      admin: { description: 'Uploading a video auto-publishes it to the social platforms on save.' } },
    { name: 'featured', type: 'checkbox', defaultValue: false,
      label: { ar: 'مميّز', en: 'Featured' } },
    // Composable body. Shared structure across locales; text inside blocks is localized.
    { name: 'content', type: 'blocks',
      label: { ar: 'المحتوى', en: 'Content' },
      blocks: [RichTextBlock, HeadingBlock, ImageBlock, YouTubeBlock, TestimonialBlock] },
    // ponytail: legacy single-body field kept read-only so existing article text is never lost.
    // The reader falls back to it when `content` is empty. Drop in a later cleanup migration
    // once articles are re-authored into blocks.
    { name: 'body', type: 'textarea',
      label: { ar: 'المحتوى (قديم)', en: 'Body (legacy)' },
      admin: { readOnly: true, description: 'Legacy markdown body — superseded by Content blocks.' } },
    // Social auto-publishing. On save, the article (and its video, if any) is fanned
    // out to the configured platforms. Results are recorded read-only in `results`.
    { name: 'social', type: 'group',
      label: { ar: 'النشر الاجتماعي', en: 'Social publishing' },
      fields: [
        { name: 'autoPublish', type: 'checkbox', defaultValue: true,
          label: { ar: 'نشر تلقائي عند الحفظ', en: 'Auto-publish on save' },
          admin: { description: 'When on, saving publishes to every configured platform. Untick to keep this article off social.' } },
        { name: 'caption', type: 'textarea',
          label: { ar: 'نص مخصص (اختياري)', en: 'Custom caption (optional)' },
          admin: { description: 'Overrides the auto-generated description/caption. The article link is appended automatically.' } },
        // Per-platform outcome, written by the publish hook. JSON = one column, no child tables.
        { name: 'results', type: 'json',
          label: { ar: 'نتائج النشر', en: 'Publish results' },
          admin: { readOnly: true, description: 'Auto-filled: platform, status, URL/id, or error.' } },
      ] },
  ],
  hooks: {
    afterChange: [publishArticleSocial],
  },
}

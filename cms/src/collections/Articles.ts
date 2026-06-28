import type { CollectionConfig } from 'payload'

export const Articles: CollectionConfig = {
  slug: 'articles',
  labels: {
    singular: { ar: 'مقال', en: 'Article' },
    plural: { ar: 'المقالات', en: 'Articles' },
  },
  admin: { useAsTitle: 'title', defaultColumns: ['title', 'date', 'category', 'featured'] },
  access: { read: () => true },
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true, index: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Markdown filename. Lowercase, hyphenated.' } },
    { name: 'title', type: 'text', required: true, localized: true,
      label: { ar: 'العنوان', en: 'Title' } },
    { name: 'date', type: 'date', required: true,
      label: { ar: 'التاريخ', en: 'Date' } },
    { name: 'author', type: 'text', required: true,
      label: { ar: 'الكاتب', en: 'Author' } },
    { name: 'category', type: 'select', required: true,
      label: { ar: 'التصنيف', en: 'Category' },
      options: [
        { label: { ar: 'أخبار المستشفى', en: 'Hospital News' }, value: 'hospital-news' },
        { label: { ar: 'نصائح صحية', en: 'Health Tips' }, value: 'health-tips' },
        { label: { ar: 'أبحاث', en: 'Research' }, value: 'research' },
        { label: { ar: 'فعاليات', en: 'Events' }, value: 'events' },
      ] },
    { name: 'thumbnail', type: 'text', required: true,
      label: { ar: 'الصورة المصغّرة', en: 'Thumbnail' },
      admin: { description: 'Image URL' } },
    { name: 'featured', type: 'checkbox', defaultValue: false,
      label: { ar: 'مميّز', en: 'Featured' } },
    // ponytail: single markdown body (matches current one-body-per-file). Make localized if
    // articles ever need separate AR/EN bodies.
    { name: 'body', type: 'textarea',
      label: { ar: 'المحتوى', en: 'Body' },
      admin: { description: 'Markdown body' } },
  ],
}

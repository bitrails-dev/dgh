import { APIError, type CollectionConfig } from 'payload'

// Editable article categories. Create / rename freely. Deletion is guarded (see hooks/endpoint)
// so a category in use is never silently orphaned.
export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: {
    singular: { ar: 'تصنيف', en: 'Category' },
    plural: { ar: 'التصنيفات', en: 'Categories' },
  },
  admin: { useAsTitle: 'name', defaultColumns: ['name', 'color'] },
  access: { read: () => true },
  hooks: {
    // Safety net: never let a category vanish out from under articles. The reassign-delete
    // endpoint clears/moves referencing articles first, so by the time it deletes, count is 0.
    beforeDelete: [
      async ({ req, id }) => {
        const { totalDocs } = await req.payload.count({
          collection: 'articles',
          where: { categoryRel: { equals: id } },
          req,
        })
        if (totalDocs > 0) {
          throw new APIError(
            `Cannot delete: ${totalDocs} article(s) still use this category. Reassign or clear them first.`,
            400,
          )
        }
      },
    ],
  },
  endpoints: [
    // POST /api/categories/:id/reassign-delete  body: { mode: 'clear' | 'move' | 'delete', target?: id }
    // Reassigns every referencing article, then deletes the category.
    {
      path: '/:id/reassign-delete',
      method: 'post',
      handler: async (req) => {
        if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
        const id = req.routeParams?.id as string
        let body: any = {}
        try { body = (await req.json?.()) ?? {} } catch { /* empty body */ }
        const mode: string = body.mode ?? 'clear'
        const target = body.target
        if (mode === 'move' && !target) {
          return Response.json({ error: 'A target category is required to move articles.' }, { status: 400 })
        }
        const newValue = mode === 'move' ? target : null
        // Reassign first so the beforeDelete guard passes.
        await req.payload.update({
          collection: 'articles',
          where: { categoryRel: { equals: id } },
          data: { categoryRel: newValue },
          req,
        })
        await req.payload.delete({ collection: 'categories', id, req })
        return Response.json({ ok: true })
      },
    },
  ],
  fields: [
    { name: 'slug', type: 'text', required: true, unique: true,
      label: { ar: 'المعرّف', en: 'Slug' },
      admin: { description: 'Lowercase, hyphenated. Used in URLs/filters.' } },
    { name: 'name', type: 'text', required: true, localized: true,
      label: { ar: 'الاسم', en: 'Name' } },
    // Token color from the design palette — the frontend maps this to Tailwind classes.
    { name: 'color', type: 'select', defaultValue: 'ink',
      label: { ar: 'اللون', en: 'Color' },
      options: [
        { label: { ar: 'أخضر مزرق', en: 'Teal' }, value: 'teal' },
        { label: { ar: 'كحلي', en: 'Navy' }, value: 'navy' },
        { label: { ar: 'ذهبي', en: 'Gold' }, value: 'gold' },
        { label: { ar: 'رمادي', en: 'Ink' }, value: 'ink' },
        { label: { ar: 'مرجاني', en: 'Coral' }, value: 'coral' },
        { label: { ar: 'زيتي', en: 'Sage' }, value: 'sage' },
      ] },
    // Safe-delete panel (clear / move / delete-anyway). Renders on the edit page.
    { name: 'safeDelete', type: 'ui',
      admin: { components: { Field: '/src/admin/CategoryDeletePanel#default' } } },
  ],
}

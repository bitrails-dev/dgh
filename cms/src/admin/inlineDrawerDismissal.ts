import type { DocumentEvent } from 'payload'

// Pure decision core for the inline-create drawer dismissal (Task B). The React provider
// (InlineCreateDismissalProvider) consumes Payload's public `useDocumentEvents` hook and
// @faceless-ui's `useModal`; this function is the only non-trivial logic and is unit-tested in
// isolation.
//
// Rule: dismiss EXACTLY a successful relationship `create` that carries an originating `drawerSlug`.
// - `update`/edit drawers are never closed (the plan requires they stay open).
// - A main-form create carries no `drawerSlug`, so it is never dismissed.
// - Upload/media creation already closes itself and is unaffected.
//
// Returns the drawer slug to close, or null to do nothing.
export const drawerSlugToDismiss = (event: DocumentEvent | null | undefined): string | null => {
  if (!event) return null
  if (event.operation !== 'create') return null
  const slug = event.drawerSlug
  return typeof slug === 'string' && slug.length > 0 ? slug : null
}

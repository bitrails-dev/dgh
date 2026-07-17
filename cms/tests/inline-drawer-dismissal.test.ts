// Task B (part 2): the decision core for closing a successful inline relationship "create" drawer.
// The React provider (admin/InlineCreateDismissalProvider) consumes Payload's public
// useDocumentEvents() and @faceless-ui useModal(); this pure function is the only non-trivial logic
// and the part we can assert deterministically. Rule: close EXACTLY a successful `create` that
// carries an originating drawerSlug. Never close update/edit drawers, main-form saves, or events
// without a drawer slug.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DocumentEvent } from 'payload'
import { drawerSlugToDismiss } from '../src/admin/inlineDrawerDismissal'

const ev = (overrides: Partial<DocumentEvent>): DocumentEvent =>
  ({ entitySlug: 'categories', updatedAt: '2026-07-15T00:00:00.000Z', ...overrides }) as DocumentEvent

test('a successful create carrying a drawerSlug returns that slug (to be closed)', () => {
  assert.equal(drawerSlugToDismiss(ev({ operation: 'create', drawerSlug: 'doc-drawer-abc' })), 'doc-drawer-abc')
})

test('an update event is never dismissed — edit drawers stay open', () => {
  assert.equal(drawerSlugToDismiss(ev({ operation: 'update', drawerSlug: 'doc-drawer-abc' })), null)
})

test('a main-form create (no drawerSlug) is never dismissed', () => {
  assert.equal(drawerSlugToDismiss(ev({ operation: 'create' })), null)
})

test('an empty drawerSlug is treated as no drawer (defensive)', () => {
  assert.equal(drawerSlugToDismiss(ev({ operation: 'create', drawerSlug: '' })), null)
})

test('a null/undefined event is a no-op', () => {
  assert.equal(drawerSlugToDismiss(null), null)
  assert.equal(drawerSlugToDismiss(undefined), null)
})

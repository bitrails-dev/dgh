'use client'
// Global admin provider (Task B): dismisses a successful inline relationship "create" drawer the
// instant its new document is assigned. Payload's Relationship field already detects the matching
// create — via the PUBLIC `useDocumentEvents()` hook, comparing `mostRecentUpdate.drawerSlug` to its
// own drawer — and assigns the freshly created doc to the field, but it leaves the DocumentDrawer
// open. This provider closes exactly that drawer, once.
//
// Guarantees (matching the plan):
//   - Only `operation === 'create'` events with a drawerSlug close anything (see drawerSlugToDismiss).
//   - Update/edit drawers, failed creates, the parent form, and unrelated modals are untouched.
//   - Upload/media creation already closes itself; an extra closeModal on its slug is a no-op.
//   - Each event is processed once (StrictMode double-invoke / re-render safe).
//   - Public hooks only — no node_modules patching, no category-specific special-casing.
import React, { useEffect, useRef } from 'react'
import type { DocumentEvent } from 'payload'
import { useDocumentEvents } from '@payloadcms/ui'
import { useModal } from '@faceless-ui/modal'
import { drawerSlugToDismiss } from './inlineDrawerDismissal'

export default function InlineCreateDismissalProvider({ children }: { children?: React.ReactNode }) {
  const { mostRecentUpdate } = useDocumentEvents()
  // Custom admin providers mount ABOVE Payload's ModalProvider, so useModal() can return the empty
  // default context where closeModal/isModalOpen are undefined (this previously threw at runtime:
  // "isModalOpen is not a function"). Treat the modal API as best-effort: skip cleanly when it is
  // unavailable — the drawer simply stays open — instead of crashing the admin.
  const { closeModal, isModalOpen } = useModal() as Partial<ReturnType<typeof useModal>>
  const processed = useRef<DocumentEvent | null>(null)

  useEffect(() => {
    const slug = drawerSlugToDismiss(mostRecentUpdate)
    if (!slug) return
    // Process each DocumentEvent exactly once across re-renders / StrictMode double-invoke.
    if (mostRecentUpdate === processed.current) return
    processed.current = mostRecentUpdate
    // Close exactly this drawer; closeModal is a no-op if it isn't open. Best-effort when the modal
    // context is unavailable (provider mounted outside ModalProvider).
    if (typeof closeModal !== 'function') return
    if (typeof isModalOpen !== 'function' || isModalOpen(slug)) closeModal(slug)
  }, [mostRecentUpdate, closeModal, isModalOpen])

  return <>{children}</>
}

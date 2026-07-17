'use client'
// Live-applies the selected Tenant Type's `defaultFeatures` template to this Tenant's `features`
// (Capabilities) field when a super-admin selects/changes the `type`.
//
// Safety: if capabilities are ALREADY selected, the user is asked to confirm replacing them with the
// new type's defaults before anything is overwritten. If capabilities are empty (or the user
// declines), no clobber. Later manual edits are preserved (this only runs on a genuine type change).
//
// Change detection compares the current `type` to the form's INITIAL `type` (the value the doc
// loaded with), so it is robust to the form's uninitialized → loaded transition — it never fires on
// open, only when the user actually moves the type away from the loaded value. Reads the (public,
// non-secret) template from the tenant-types read API. UI-only field: renders/stores nothing.
import React, { useEffect, useRef } from 'react'
import { useConfig, useField } from '@payloadcms/ui'

type TypeValue = string | number | { id?: string | number } | Array<string | number | { id?: string | number }> | undefined | null

const idOf = (v: TypeValue): string | null => {
  if (v == null) return null
  if (typeof v === 'string' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.length ? idOf(v[0]) : null
  return v.id != null ? String(v.id) : null
}

const CONFIRM_MSG =
  "Changing the entity type will replace the currently selected capabilities with the new type's default template. Apply the new defaults?"

export default function ApplyTypeTemplate() {
  const { config } = useConfig()
  const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`
  const typeField = useField<TypeValue>({ path: 'type' })
  const featuresField = useField<string[]>({ path: 'features' })
  const typeId = idOf(typeField.value)
  const initialTypeId = idOf(typeField.initialValue)
  // Marks a typeId as already handled (prompted) so re-renders never re-prompt for the same type.
  const handled = useRef<string | null>(null)

  useEffect(() => {
    // Only react to a genuine user change: a type that is set AND differs from the loaded value.
    if (!typeId) return
    if (typeId === initialTypeId) return
    if (handled.current === typeId) return
    handled.current = typeId

    // If capabilities are already selected, confirm before overwriting them. Empty → apply directly.
    const current = featuresField.value
    const hasExisting = Array.isArray(current) && current.length > 0
    if (hasExisting && typeof window !== 'undefined' && !window.confirm(CONFIRM_MSG)) {
      return // user declined — keep the current capabilities untouched
    }

    let cancelled = false
    void (async () => {
      try {
        // NOTE: do NOT use ?select=defaultFeatures — Payload's `select` param drops select-type fields
        // here (returns only {id}). depth=0 is enough; defaultFeatures comes back on the full doc.
        const res = await fetch(`${apiBase}/tenant-types/${typeId}?depth=0`, { credentials: 'include' })
        if (!res.ok) return
        const body = (await res.json()) as { defaultFeatures?: string[] | null }
        if (!cancelled) {
          featuresField.setValue(Array.isArray(body.defaultFeatures) ? body.defaultFeatures : [])
        }
      } catch {
        // best-effort: a lookup failure leaves the current capabilities untouched
      }
    })()
    return () => { cancelled = true }
  }, [typeId, initialTypeId, apiBase, featuresField])

  return null
}

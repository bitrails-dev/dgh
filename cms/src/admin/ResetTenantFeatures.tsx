'use client'
// Super-admin-only reset control rendered on the Tenant edit form. Confirms, calls the Tenant
// /reset-features-to-type-defaults endpoint (which clones the current type template into this
// tenant), surfaces success/error, then reloads the document so stored state is visible. Hidden
// from tenant admins and on the create form (no id yet) via the field's admin.condition.
import React, { useState } from 'react'
import { useDocumentInfo, useConfig } from '@payloadcms/ui'

export default function ResetTenantFeatures() {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (!id) return null

  async function run() {
    const ok = window.confirm(
      'Reset this entity\u2019s capabilities to its current type template? This replaces the current set and cannot be undone.',
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const res = await fetch(`${apiBase}/tenants/${id}/reset-features-to-type-defaults`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error ?? `HTTP ${res.status}`)
      }
      setDone(true)
      // Refresh the form/document so the stored feature set is visible after the reset.
      window.location.reload()
    } catch (e: any) {
      setError(String(e?.message ?? e))
      setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 16, marginTop: 24 }}>
      <h4 style={{ margin: '0 0 8px' }}>Reset capabilities</h4>
      <p style={{ marginTop: 0 }}>
        Replace this entity&rsquo;s capabilities with the current default template of its assigned type.
      </p>
      <button type="button" className="btn btn--style-secondary" disabled={busy} onClick={run}>
        {busy ? 'Resetting\u2026' : 'Reset to type defaults'}
      </button>
      {done && !error && (
        <p style={{ color: 'var(--theme-success-500, green)', marginTop: 8 }}>Reset successful \u2014 refreshing\u2026</p>
      )}
      {error && <p style={{ color: 'var(--theme-error-500)', marginTop: 8 }}>{error}</p>}
    </div>
  )
}

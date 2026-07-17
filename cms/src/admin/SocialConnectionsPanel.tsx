'use client'
// Per-platform social connection panel on the Tenant edit form. Reads sanitized status (incl. the
// platform label + availability) from /api/tenants/:id/social-status — NO label map is duplicated
// here; every label/availability flag comes from the single platform catalogue via the server
// response. Offers OAuth Connect (redirect, only for available platforms) / Disconnect, and shows the
// last publish result. Rendered only when `socialPublishing` is visible and the doc exists.
import React, { useEffect, useState } from 'react'
import { useDocumentInfo, useConfig } from '@payloadcms/ui'

type PlatformStatus = {
  platform: string
  label: string
  available: boolean
  approvalNote: string
  connected: boolean
  status: string
  remoteAccountLabel: string
  lastPublishStatus: string
  lastPublishUrl: string
  lastPublishAt: string
  lastErrorCode: string
  lastFailedArticleId: string
}

export default function SocialConnectionsPanel() {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`
  const [platforms, setPlatforms] = useState<PlatformStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!id) return
    setError(null)
    try {
      const res = await fetch(`${apiBase}/tenants/${id}/social-status`, { credentials: 'include' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`)
      setPlatforms(body.platforms as PlatformStatus[])
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    }
  }

  useEffect(() => { void load() }, [id])

  if (!id) return null

  const connect = (platform: string) => {
    const returnTo = `${window.location.pathname}${window.location.search}`
    window.location.href = `${apiBase}/social/connect/${platform}?tenant=${id}&returnTo=${encodeURIComponent(returnTo)}`
  }
  const disconnect = async (platform: string) => {
    if (!window.confirm(`Disconnect ${platform}?`)) return
    const res = await fetch(`${apiBase}/social/disconnect`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ tenant: id, platform }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`)
    if (res.ok && body?.revoked === 'failed') setError(`${platform} revocation failed — retry from the provider console.`)
    await load()
  }
  const retry = async (platform: string, articleId: string) => {
    setError(null)
    const res = await fetch(`${apiBase}/social/retry-publication`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ tenantId: id, articleId, platform }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setError(body?.error ?? `HTTP ${res.status}`)
    else await load()
  }

  return (
    <div style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 16, marginTop: 24 }}>
      <h4 style={{ margin: '0 0 8px' }}>Social connections</h4>
      <p style={{ marginTop: 0 }}>
        Connect each platform to enable auto-publishing. Inclusion is set in the “Included platforms” field.
      </p>
      {error && <p style={{ color: 'var(--theme-error-500)' }}>{error}</p>}
      {!platforms && !error && <p>Loading…</p>}
      {platforms?.map((p) => (
        <div key={p.platform} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderTop: '1px solid var(--theme-elevation-100)' }}>
          <div>
            <strong>{p.label}</strong>{p.remoteAccountLabel ? ` — ${p.remoteAccountLabel}` : ''}
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {p.connected
                ? `connected · last: ${p.lastPublishStatus || '—'}`
                : p.available
                  ? `not connected${p.status === 'reconnect_required' ? ' (reconnect required)' : ''}`
                  : `not available${p.approvalNote ? ` — ${p.approvalNote}` : ''}`}
              {p.lastErrorCode ? ` · ${p.lastErrorCode}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {p.available && (p.connected ? (
              <>
                {p.lastPublishStatus === 'failed' && p.lastFailedArticleId ? (
                  <button type="button" className="btn btn--style-secondary" onClick={() => retry(p.platform, p.lastFailedArticleId)}>Retry</button>
                ) : null}
                <button type="button" className="btn btn--style-secondary" onClick={() => disconnect(p.platform)}>Disconnect</button>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => connect(p.platform)}>Connect</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

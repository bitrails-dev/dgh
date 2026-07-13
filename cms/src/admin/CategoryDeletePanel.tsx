'use client'
// Safe-delete panel shown on the Category edit page. Lets an editor delete a category that is
// still in use by choosing what happens to its articles: clear the category, move them to another
// category, or delete anyway (clears them). Calls the collection's /reassign-delete endpoint,
// which reassigns first so the beforeDelete guard passes. Registered as a `ui` field on Categories.
import React, { useEffect, useState } from 'react'
import { useDocumentInfo, useConfig } from '@payloadcms/ui'

type Cat = { id: string | number; name?: string; slug?: string }

export default function CategoryDeletePanel() {
  const { id } = useDocumentInfo()
  const { config } = useConfig()
  const apiBase = `${config?.serverURL ?? ''}${config?.routes?.api ?? '/api'}`

  const [count, setCount] = useState<number | null>(null)
  const [others, setOthers] = useState<Cat[]>([])
  const [target, setTarget] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      try {
        const a = await fetch(`${apiBase}/articles?where[categoryRel][equals]=${id}&limit=0&depth=0`, { credentials: 'include' })
        const aj = await a.json()
        setCount(aj?.totalDocs ?? 0)
        const c = await fetch(`${apiBase}/categories?limit=200&depth=0`, { credentials: 'include' })
        const cj = await c.json()
        setOthers((cj?.docs ?? []).filter((d: Cat) => String(d.id) !== String(id)))
      } catch (e: any) {
        setError(String(e?.message ?? e))
      }
    })()
  }, [id, apiBase])

  if (!id) return null

  async function run(mode: 'clear' | 'move' | 'delete') {
    if (mode === 'move' && !target) { setError('Choose a category to move articles to.'); return }
    const verb = mode === 'move' ? 'move its articles to another category' : mode === 'clear' ? 'clear the category from its articles' : 'delete anyway (articles keep no category)'
    if (!confirm(`Delete this category and ${verb}?`)) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${apiBase}/categories/${id}/reassign-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ mode, target: mode === 'move' ? target : undefined }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `HTTP ${res.status}`) }
      window.location.href = `${config?.routes?.admin ?? '/admin'}/collections/categories`
    } catch (e: any) {
      setError(String(e?.message ?? e)); setBusy(false)
    }
  }

  return (
    <div style={{ border: '1px solid var(--theme-elevation-150)', borderRadius: 4, padding: 16, marginTop: 24 }}>
      <h4 style={{ margin: '0 0 8px' }}>Delete safely</h4>
      {count === null ? (
        <p>Checking usage…</p>
      ) : count === 0 ? (
        <p>No articles use this category — it can be deleted normally from the toolbar.</p>
      ) : (
        <>
          <p><strong>{count}</strong> article(s) use this category. Choose what happens to them:</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn--style-secondary" disabled={busy} onClick={() => run('clear')}>
              Clear category & delete
            </button>
            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
              <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
                <option value="">Move to…</option>
                {others.map((o) => <option key={String(o.id)} value={String(o.id)}>{o.name ?? o.slug ?? o.id}</option>)}
              </select>
              <button type="button" className="btn btn--style-secondary" disabled={busy} onClick={() => run('move')}>
                Move & delete
              </button>
            </span>
            <button type="button" className="btn btn--style-secondary" disabled={busy} onClick={() => run('delete')}>
              Delete anyway
            </button>
          </div>
        </>
      )}
      {error && <p style={{ color: 'var(--theme-error-500)' }}>{error}</p>}
    </div>
  )
}

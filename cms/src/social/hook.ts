// Article → social-publish trigger (Task 1).
//   - defaultAutoPublishFromTenant (beforeChange, create): when the caller omits `autoPublish`,
//     default it from the tenant's `socialPublishing.defaultAutoPublish`. Explicit false is kept.
//   - queueSocialPublish (afterChange, create-only): enqueues ONE durable Payload job carrying only
//     stable IDs { tenantId, articleId }. The worker does the provider fan-out, so a process restart
//     never loses work, provider failure never rolls back the Article, and re-saves never duplicate.
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'
import { shouldQueueArticle } from './decide'
import { SOCIAL_PUBLISH_TASK_SLUG, SOCIAL_QUEUE } from './jobs'
import type { Platform } from './types'

export const defaultAutoPublishFromTenant: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create') return data
  const incoming = data as Record<string, unknown>
  if (incoming.autoPublish !== undefined) return data // explicit (including false) is preserved
  const tenantId = incoming.tenant
  if (tenantId === undefined || tenantId === null) return data
  const tenant = await req.payload.findByID({
    collection: 'tenants',
    id: tenantId as number | string,
    depth: 0,
    overrideAccess: true,
    req,
    select: { socialPublishing: true },
  }).catch(() => null) as { socialPublishing?: { defaultAutoPublish?: boolean } } | null
  incoming.autoPublish = !!tenant?.socialPublishing?.defaultAutoPublish
  return data
}

export const queueSocialPublish: CollectionAfterChangeHook = async ({ doc, operation, req, context }) => {
  if (operation !== 'create') return doc
  if ((context as { skipSocial?: boolean } | undefined)?.skipSocial) return doc
  const article = doc as Record<string, unknown>
  const tenantId = article.tenant
  if (tenantId === undefined || tenantId === null) return doc
  if (!article.autoPublish) return doc // explicit/defaulted false → never enqueue

  try {
    const tenant = await req.payload.findByID({
      collection: 'tenants', id: tenantId as number | string, depth: 0, overrideAccess: true, req, locale: 'all',
      select: { socialPublishing: true },
    }).catch(() => null) as { socialPublishing?: { enabled?: boolean; includedPlatforms?: Platform[] } } | null
    const sp = tenant?.socialPublishing ?? {}
    if (!sp.enabled) return doc
    const conns = await req.payload.find({
      collection: 'social-connections',
      where: { and: [{ tenant: { equals: tenantId } }, { status: { equals: 'connected' } }] },
      overrideAccess: true, req, limit: 100,
    })
    const connected = Array.from(new Set(conns.docs.map((c) => (c as { platform: Platform }).platform))) as Platform[]
    const targets = shouldQueueArticle({
      tenantEnabled: !!sp.enabled,
      articleAutoPublish: true,
      includedPlatforms: (sp.includedPlatforms ?? []) as Platform[],
      connectedPlatforms: connected,
    })
    if (!targets) return doc
    // Enqueue one durable job on the social-publishing queue: stable IDs + the deterministic target
    // snapshot captured at create time. Runs after the Article transaction committed, so a provider
    // failure can never roll the Article back; a queue error is swallowed (isolated).
    await req.payload.jobs.queue({
      task: SOCIAL_PUBLISH_TASK_SLUG,
      input: { tenantId: Number(tenantId), articleId: Number(article.id), platforms: targets },
      queue: SOCIAL_QUEUE,
      req,
    })
  } catch {
    // Isolated: a queue failure must never surface on the Article save.
  }
  return doc
}

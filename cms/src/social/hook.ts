import type { CollectionAfterChangeHook } from 'payload'
import type { Platform, PublishResult } from './types'
import { buildPublishInput } from './content'
import { dispatch, mergeResults } from './dispatch'

// afterChange on Articles. Fans the article out to the social platforms the moment
// it's saved (create or update), unless the author unticked social.autoPublish.
//
// Design notes:
//  - Non-blocking: the admin Save returns immediately; publishing runs in the
//    background and writes results back onto the doc.
//    ponytail: no durable queue — a process restart mid-upload loses that attempt;
//    it's retried on the next save. Add a real job queue if that matters.
//  - Idempotent: platforms that already succeeded are skipped, so re-saving (or the
//    results write-back itself) never double-posts.
//  - Loop-safe: the write-back sets context.skipSocial so it doesn't re-trigger.
export const publishArticleSocial: CollectionAfterChangeHook = ({ doc, req, context }) => {
  if (req?.context?.skipSocial || context?.skipSocial) return doc
  const payload = req.payload
  const id = doc?.id
  if (!id) return doc

  // Fire and forget — do not block the editor on network uploads.
  void runPublish(payload, id).catch((e) => {
    payload.logger.error(`[social] publish failed for article ${id}: ${e?.message ?? e}`)
  })
  return doc
}

async function runPublish(payload: any, id: string | number): Promise<void> {
  const full = await payload.findByID({
    collection: 'articles',
    id,
    depth: 1,
    locale: 'all',
    overrideAccess: true,
  })
  if (!full) return
  if (full.social?.autoPublish === false) {
    payload.logger.info(`[social] article ${id}: autoPublish off, skipping`)
    return
  }

  const input = buildPublishInput(full)
  const prior: PublishResult[] = Array.isArray(full.social?.results) ? full.social.results : []
  const done = new Set<Platform>(
    prior.filter((r) => r.status === 'success').map((r) => r.platform),
  )

  const fresh = await dispatch(input, done)
  const merged = mergeResults(prior, fresh)

  const summary = fresh.map((r) => `${r.platform}:${r.status}`).join(' ')
  payload.logger.info(`[social] article ${id} (${input.hasVideo ? 'video' : 'link'}) → ${summary}`)

  await payload.update({
    collection: 'articles',
    id,
    locale: 'ar',
    overrideAccess: true,
    context: { skipSocial: true },
    data: {
      social: {
        autoPublish: full.social?.autoPublish ?? true,
        caption: full.social?.caption ?? null,
        results: merged,
      },
    },
  })
}

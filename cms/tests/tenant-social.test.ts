// Task C (unit): the eight social profile URL fields, the socialPublishing settings group, and its
// entitlement enforcement. The migration round-trip lives in tenant-social-migration.test.ts.
import assert from 'node:assert/strict'
import test from 'node:test'
import { Tenants, SOCIAL_PLATFORMS } from '../src/collections/Tenants'
import { enforceTenantSettingsEntitlement } from '../src/access/tenantSettings'

type HookArgs = Parameters<typeof enforceTenantSettingsEntitlement>[0]
const superAdmin = { id: 1, roles: ['super-admin'], tenants: [] }
const tenantAdmin = (id: number | string = 7) => ({ id: 2, roles: ['admin'], tenants: [{ tenant: id }] })

const findField = (name: string) =>
  Tenants.fields.find((f) => 'name' in f && (f as { name?: string }).name === name)

// ---------------------------------------------------------------------------
// 1. The eight required social platforms + WhatsApp is NOT a publish target
// ---------------------------------------------------------------------------

test('SOCIAL_PLATFORMS covers exactly the eight required public-feed platforms', () => {
  assert.deepEqual(
    SOCIAL_PLATFORMS.map((p) => p.key),
    ['facebook', 'instagram', 'x', 'threads', 'snapchat', 'youtube', 'linkedin', 'tiktok'],
  )
  // WhatsApp is a contact channel, never a publishing target.
  assert.equal(
    (SOCIAL_PLATFORMS as ReadonlyArray<{ key: string }>).some((p) => p.key === 'whatsapp'),
    false,
  )
})

test('contact.social has one optional URL field per platform with http(s) validation', () => {
  const contact = findField('contact') as { type?: string; fields?: Array<{ name?: string; type?: string; validate?: (v: unknown) => unknown }> } | undefined
  assert.equal(contact?.type, 'group')
  const social = contact?.fields?.find((f) => f.name === 'social') as
    | { type?: string; fields?: Array<{ name?: string; validate?: (v: unknown) => unknown }> }
    | undefined
  assert.equal(social?.type, 'group')
  const names = (social?.fields ?? []).map((f) => f.name)
  assert.deepEqual(
    names,
    ['facebookUrl', 'instagramUrl', 'xUrl', 'threadsUrl', 'snapchatUrl', 'youtubeUrl', 'linkedinUrl', 'tiktokUrl'],
  )

  const validate = social?.fields?.[0]?.validate
  if (typeof validate !== 'function') throw new TypeError('social URL field must have a validate fn')
  assert.equal(validate(undefined), true)
  assert.equal(validate(''), true)
  assert.equal(validate('https://fb.me/x'), true)
  assert.equal(validate('http://fb.me/x'), true)
  // Non-http schemes are rejected.
  assert.equal(validate('ftp://x'), 'Enter a valid http(s) URL.')
  assert.equal(validate('not-a-url'), 'Enter a valid http(s) URL.')
})

// ---------------------------------------------------------------------------
// 2. socialPublishing settings group: master + default + per-platform inclusion
// ---------------------------------------------------------------------------

const socialPublishingField = () => findField('socialPublishing') as {
  type?: string
  fields?: Array<{ name?: string; type?: string; defaultValue?: unknown; options?: Array<{ value: string }> }>
} | undefined

test('socialPublishing is a group with master enable + default-auto-publish both off by default', () => {
  const sp = socialPublishingField()
  assert.equal(sp?.type, 'group')
  const enabled = sp?.fields?.find((f) => f.name === 'enabled')
  assert.equal(enabled?.type, 'checkbox')
  assert.equal(enabled?.defaultValue, false)
  const def = sp?.fields?.find((f) => f.name === 'defaultAutoPublish')
  assert.equal(def?.type, 'checkbox')
  assert.equal(def?.defaultValue, false)
})

test('includedPlatforms is a multi-select over the eight platforms (no WhatsApp)', () => {
  const inc = socialPublishingField()?.fields?.find((f) => f.name === 'includedPlatforms') as
    | { type?: string; options?: Array<{ value: string }> }
    | undefined
  assert.equal(inc?.type, 'select')
  assert.deepEqual(
    (inc?.options ?? []).map((o) => o.value),
    SOCIAL_PLATFORMS.map((p) => p.key),
  )
})

// ---------------------------------------------------------------------------
// 3. socialPublishing is enforced by the setting entitlement (server-side boundary)
// ---------------------------------------------------------------------------

const runHook = (args: { user: unknown; data: Record<string, unknown>; originalDoc: Record<string, unknown> }) =>
  enforceTenantSettingsEntitlement({
    data: args.data,
    originalDoc: args.originalDoc,
    operation: 'update',
    req: { user: args.user },
  } as HookArgs)

const baseTenant = (entitlement: string[]) => ({
  id: 7,
  slug: 'al-salam',
  type: 1,
  settingsEntitlement: entitlement,
  socialPublishing: { enabled: false, defaultAutoPublish: false, includedPlatforms: [] },
})

test('a tenant admin WITH the socialPublishing entitlement may edit it', () => {
  assert.doesNotThrow(() =>
    runHook({
      user: tenantAdmin(),
      originalDoc: baseTenant(['contact', 'socialPublishing']) as never,
      data: { socialPublishing: { enabled: true, defaultAutoPublish: true, includedPlatforms: ['facebook', 'instagram'] } },
    }),
  )
})

test('a tenant admin WITHOUT the socialPublishing entitlement is rejected with 403', () => {
  assert.throws(
    () =>
      runHook({
        user: tenantAdmin(),
        originalDoc: baseTenant(['contact']) as never,
        data: { socialPublishing: { enabled: true } },
      }),
    (err: { status?: number; message?: string }) => {
      assert.equal(err.status, 403)
      assert.match(err.message ?? '', /not entitled to edit "socialPublishing"/)
      return true
    },
  )
})

test('a super-admin bypasses the socialPublishing entitlement regardless of grant', () => {
  assert.doesNotThrow(() =>
    runHook({
      user: superAdmin,
      originalDoc: baseTenant([]) as never,
      data: { socialPublishing: { enabled: true, includedPlatforms: ['tiktok'] } },
    }),
  )
})

test('the socialPublishing group is visible only when entitled (or super-admin)', () => {
  const sp = findField('socialPublishing') as { admin?: { condition?: (d: unknown, s: unknown, c: { user: unknown }) => boolean } } | undefined
  const condition = sp?.admin?.condition
  if (typeof condition !== 'function') throw new TypeError('socialPublishing.admin.condition must be a function')
  assert.equal(condition({ settingsEntitlement: ['socialPublishing'] }, undefined, { user: tenantAdmin() }), true)
  assert.equal(condition({ settingsEntitlement: ['contact'] }, undefined, { user: tenantAdmin() }), false)
  assert.equal(condition({ settingsEntitlement: [] }, undefined, { user: superAdmin }), true)
})

// Provision ONE commerce tenant end-to-end so an operator can enable commerce in sandbox.
//
// Run:  npx tsx scripts/provision-commerce-tenant.ts --tenant <slug> [--currency EGP]
//                                                 [--tax-mode exclusive|inclusive] [--sandbox]
//                                                 [--help]
//       (cwd = cms; the CMS must be migrated first: `npx payload migrate`)
//
// Idempotent: every artifact is tenant-scoped and skip-if-exists, so re-running after a partial
// failure or after rotating gateway creds only fills gaps. It does NOT flip the tenant `commerce`
// feature on — that is the operator's manual gate (the summary reports the current flag state).
//
// Environment variables (read at call time; NEVER hardcoded):
//   COMMERCE_TENANT_SLUG        Tenant slug to provision (alt to --tenant).
//   COMMERCE_CURRENCY            ISO-4217 code, default EGP (the launch currency).
//   COMMERCE_TAX_MODE            'exclusive' (default) | 'inclusive'.
//   COMMERCE_SANDBOX             'true' treats gateway creds as sandbox/test (default 'true').
//
//   Paymob (sandbox) — enables the Paymob group only when ALL four are present:
//     PAYMOB_API_KEY, PAYMOB_HMAC_SECRET, PAYMOB_IFRAME_ID, PAYMOB_INTEGRATION_ID
//   Kashier (sandbox) — enables the Kashier group only when ALL three are present:
//     KASHIER_API_KEY, KASHIER_WEBHOOK_SECRET, KASHIER_MERCHANT_ID
//
//   Gift card (optional; skips with a warning when the pepper is unset):
//     COMMERCE_GIFT_CARD_PEPPER       base64 >= 32 decoded bytes (required to hash a generated code).
//     COMMERCE_PROVISION_GIFT_CARD_AMOUNT  integer EGP minor units (default 10000 = 100.00 EGP).
//
//   CMS connection (see cms/.env.example):
//     PAYLOAD_SECRET, DATABASE_URI, PAYLOAD_PUBLIC_SERVER_URL.
//
// Secrets are written through the encrypted gateway-config path: commerce-settings' handleSecrets
// hook AES-256-GCM-encrypts paymob.apiKey/hmacSecret + kashier.apiKey/webhookSecret on write, and
// loadGatewayConfig decrypts them at runtime. The gift-card raw code is hashed (HMAC-SHA256 under
// COMMERCE_GIFT_CARD_PEPPER) and shown ONCE; only codeHash + lastFour are stored (section 3.10).
import 'dotenv/config'
import { randomBytes, createHmac } from 'node:crypto'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { normalizeGiftCardCode, resolveGiftCardPepper } from '../src/commerce/policies/gift-card-hash'

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') { out.help = true; continue }
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++ } else { out[key] = true }
    }
  }
  return out
}

const HELP = `Usage: npx tsx scripts/provision-commerce-tenant.ts --tenant <slug> [options]

Idempotently provisions commerce for ONE tenant (commerce-settings, inventory + sample products,
tax/shipping policy rows, a sample promotion, a gift card, and sandbox gateway credentials).

Options:
  --tenant <slug>        Tenant slug to provision (or COMMERCE_TENANT_SLUG).
  --currency <EGP>       ISO-4217 code (default EGP).
  --tax-mode <mode>      exclusive (default) | inclusive.
  --sandbox              Treat gateway creds as sandbox/test (default; COMMERCE_SANDBOX=true).

Env (see header comment for the full list): COMMERCE_TENANT_SLUG, COMMERCE_CURRENCY,
COMMERCE_TAX_MODE, COMMERCE_SANDBOX, PAYMOB_*, KASHIER_*, COMMERCE_GIFT_CARD_PEPPER,
COMMERCE_PROVISION_GIFT_CARD_AMOUNT, PAYLOAD_SECRET, DATABASE_URI.

The tenant's \`commerce\` feature is NOT flipped on — re-enable it yourself after verifying sandbox.
`

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

type PayloadLike = {
  find: (a: any) => Promise<{ docs: any[]; totalDocs?: number }>
  count: (a: any) => Promise<{ totalDocs: number }>
  create: (a: any) => Promise<any>
}

const nowIso = (): string => new Date().toISOString()

async function exists(payload: PayloadLike, collection: string, where: unknown): Promise<boolean> {
  const { totalDocs } = await payload.count({ collection: collection as never, where, overrideAccess: true })
  return totalDocs > 0
}

// Find one doc by tenant + code/slug; returns its id so related rows can reference it.
async function findOne(payload: PayloadLike, collection: string, where: unknown): Promise<any | undefined> {
  const { docs } = await payload.find({ collection: collection as never, where, overrideAccess: true, limit: 1 })
  return docs[0]
}

// Resolve an existing tenant by slug, or create a minimal tenant + tenant-type. The tenant starts
// WITHOUT the commerce feature (the operator enables it). Mirrors tests/helpers/commerce seedTenant.
async function resolveOrCreateTenant(payload: PayloadLike, slug: string): Promise<{ tenantId: number | string; created: boolean }> {
  const existing = await findOne(payload, 'tenants', { slug: { equals: slug } })
  if (existing) return { tenantId: existing.id, created: false }
  const suffix = `${slug}-${Date.now()}`
  const tt = await payload.create({
    collection: 'tenant-types', overrideAccess: true,
    data: { slug: `type-${suffix}`, name: 'Commerce', defaultFeatures: ['commerce'] },
  })
  const t = await payload.create({
    collection: 'tenants', overrideAccess: true,
    data: {
      name: `Commerce tenant ${slug}`, slug, type: tt.id, features: [],
      hero: { years: { value: '1' }, departments: { value: '1' }, patients: { value: '1' }, staff: { value: '1' } },
    },
  })
  return { tenantId: t.id, created: true }
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { process.stdout.write(HELP); return }

  const slug = String(args.tenant || process.env.COMMERCE_TENANT_SLUG || '')
  if (!slug) { process.stderr.write('ERROR: --tenant <slug> (or COMMERCE_TENANT_SLUG) is required.\n\n'); process.stdout.write(HELP); process.exit(2) }

  const currency = String(args['currency'] || process.env.COMMERCE_CURRENCY || 'EGP').toUpperCase()
  const taxMode = String(args['tax-mode'] || process.env.COMMERCE_TAX_MODE || 'exclusive') as 'exclusive' | 'inclusive'
  const sandbox = String(args.sandbox === true ? 'true' : (process.env.COMMERCE_SANDBOX ?? 'true')).toLowerCase() === 'true'

  const payload = (await getPayload({ config })) as unknown as PayloadLike
  // Ensure the schema exists (no-op on an already-migrated DB). Mirrors the integration tests; the
  // header still documents `npx payload migrate` as the operator pre-step for a fresh database.
  await (payload as unknown as { db: { migrate: () => Promise<void> } }).db.migrate()
  const { tenantId, created: tenantCreated } = await resolveOrCreateTenant(payload, slug)

  const log: string[] = []
  const note = (s: string): void => { log.push(s) }
  note(`Tenant: ${slug} (id ${tenantId})${tenantCreated ? ' [created]' : ' [existing]'}`)

  // 1. commerce-settings — EGP, exclusive tax, sandbox flag. handleSecrets encrypts the gateway
  //    secrets on write; we pass plaintext from env. Skip if this tenant already has settings.
  const hasSettings = await exists(payload, 'commerce-settings', { tenant: { equals: tenantId } })
  const paymob = {
    enabled: Boolean(process.env.PAYMOB_API_KEY && process.env.PAYMOB_HMAC_SECRET && process.env.PAYMOB_IFRAME_ID && process.env.PAYMOB_INTEGRATION_ID),
    iframeId: process.env.PAYMOB_IFRAME_ID,
    integrationId: process.env.PAYMOB_INTEGRATION_ID,
    apiKey: process.env.PAYMOB_API_KEY,
    hmacSecret: process.env.PAYMOB_HMAC_SECRET,
  }
  const kashier = {
    enabled: Boolean(process.env.KASHIER_API_KEY && process.env.KASHIER_WEBHOOK_SECRET && process.env.KASHIER_MERCHANT_ID),
    merchantId: process.env.KASHIER_MERCHANT_ID,
    apiKey: process.env.KASHIER_API_KEY,
    webhookSecret: process.env.KASHIER_WEBHOOK_SECRET,
  }
  if (hasSettings) {
    note('  commerce-settings: already exist (skipped)')
  } else {
    await payload.create({
      collection: 'commerce-settings', overrideAccess: true,
      data: { tenant: tenantId, status: 'live', currency, taxMode, sandbox, paymob, kashier } as any,
    })
    note(`  commerce-settings: created (currency ${currency}, tax ${taxMode}, sandbox ${sandbox})`)
  }
  note(`  gateway: Paymob ${paymob.enabled ? 'enabled' : 'disabled (set PAYMOB_* to enable)'}, Kashier ${kashier.enabled ? 'enabled' : 'disabled (set KASHIER_* to enable)'}`)

  // 2. inventory-location + sample products + stock levels. The sample catalog lets an operator
  //    exercise browse/cart/checkout in sandbox immediately; skip if products already exist.
  const hasProducts = await exists(payload, 'store-products', { tenant: { equals: tenantId } })
  let locationId: number | string | undefined
  const loc = await findOne(payload, 'inventory-locations', { tenant: { equals: tenantId } })
  if (loc) { locationId = loc.id; note('  inventory-location: already exists (skipped)') }
  else {
    const l = await payload.create({ collection: 'inventory-locations', overrideAccess: true, data: { tenant: tenantId, name: 'Main warehouse', slug: `wh-${slug}-${Date.now()}` } })
    locationId = l.id
    note('  inventory-location: created')
  }
  if (hasProducts) {
    note('  store-products: already exist (skipped sample catalog + stock)')
  } else {
    // A priced simple product + a variant set, mirroring the integration-test seed shapes.
    const simple = await payload.create({
      collection: 'store-products', overrideAccess: true,
      data: { tenant: tenantId, name: 'Sandbox T-Shirt', slug: 'sandbox-tee', sku: 'DGH-SAND-TEE', priceInEGPEnabled: true, priceInEGP: 5000, taxClass: 'standard', trackInventory: true, _status: 'published' } as any,
    })
    const vtype = await payload.create({ collection: 'store-variant-types', overrideAccess: true, data: { tenant: tenantId, label: 'Size', name: 'size' } as any })
    const vopt = await payload.create({ collection: 'store-variant-options', overrideAccess: true, data: { tenant: tenantId, variantType: vtype.id, label: 'Large', value: 'L' } as any })
    const vparent = await payload.create({
      collection: 'store-products', overrideAccess: true,
      data: { tenant: tenantId, name: 'Sandbox Mug', slug: 'sandbox-mug', sku: null, enableVariants: true, variantTypes: [vtype.id], taxClass: 'standard', trackInventory: true, _status: 'published' } as any,
    })
    const variant = await payload.create({ collection: 'store-variants', overrideAccess: true, data: { tenant: tenantId, product: vparent.id, options: [vopt.id], sku: 'DGH-SAND-MUG-L', priceInEGPEnabled: true, priceInEGP: 3000 } as any })
    for (const [sku, onHand] of [['DGH-SAND-TEE', 100], ['DGH-SAND-MUG-L', 50]] as const) {
      if (!(await exists(payload, 'inventory-levels', { and: [{ tenant: { equals: tenantId } }, { location: { equals: locationId } }, { sku: { equals: sku } }] }))) {
        await payload.create({ collection: 'inventory-levels', overrideAccess: true, data: { tenant: tenantId, location: locationId, sku, onHand } })
      }
    }
    note(`  sample catalog: simple ${simple.id} + variant ${variant.id}; stock DGH-SAND-TEE=100, DGH-SAND-MUG-L=50`)
  }

  // 3. tax-zones + a standard 14% tax-rate (1400 bps). Skip per code.
  if (!(await exists(payload, 'tax-zones', { and: [{ tenant: { equals: tenantId } }, { code: { equals: 'EG-STD' } }] }))) {
    const zone = await payload.create({ collection: 'tax-zones', overrideAccess: true, data: { tenant: tenantId, code: 'EG-STD', name: { en: 'Egypt standard', ar: 'مصر القياسي' }, country: 'EG', priority: 0, enabled: true } as any })
    if (!(await exists(payload, 'tax-rates', { and: [{ tenant: { equals: tenantId } }, { zone: { equals: zone.id } }, { taxClass: { equals: 'standard' } }] }))) {
      await payload.create({ collection: 'tax-rates', overrideAccess: true, data: { tenant: tenantId, zone: zone.id, taxClass: 'standard', rateBps: 1400, pricesIncludeTax: taxMode === 'inclusive', effectiveFrom: nowIso(), enabled: true } as any })
    }
    note('  tax: zone EG-STD + standard 14% (1400 bps) rate')
  } else {
    note('  tax: EG-STD already exists (skipped)')
  }

  // 4. shipping-zones + a flat-rate shipping-method. Skip per code.
  if (!(await exists(payload, 'shipping-zones', { and: [{ tenant: { equals: tenantId } }, { code: { equals: 'EG-ALL' } }] }))) {
    const szone = await payload.create({ collection: 'shipping-zones', overrideAccess: true, data: { tenant: tenantId, code: 'EG-ALL', name: { en: 'Egypt (all)', ar: 'مصر (الكل)' }, country: 'EG', priority: 0, enabled: true } as any })
    if (!(await exists(payload, 'shipping-methods', { and: [{ tenant: { equals: tenantId } }, { code: { equals: 'EG-FLAT' } }] }))) {
      await payload.create({ collection: 'shipping-methods', overrideAccess: true, data: { tenant: tenantId, zone: szone.id, code: 'EG-FLAT', name: { en: 'Flat rate', ar: 'سعر ثابت' }, basePrice: 5000, freeAboveSubtotal: 0, enabled: true } as any })
    }
    note('  shipping: zone EG-ALL + method EG-FLAT (50.00 EGP flat)')
  } else {
    note('  shipping: EG-ALL already exists (skipped)')
  }

  // 5. a sample promotion. Skip per code (the beforeChange hook normalizes the code).
  if (!(await exists(payload, 'promotions', { and: [{ tenant: { equals: tenantId } }, { code: { equals: 'WELCOME10' } }] }))) {
    await payload.create({
      collection: 'promotions', overrideAccess: true,
      data: { tenant: tenantId, code: 'WELCOME10', type: 'percentage', value: 1000, minimumSubtotal: 0, startsAt: nowIso(), enabled: true } as any,
    })
    note('  promotion: WELCOME10 (10% off)')
  } else {
    note('  promotion: WELCOME10 already exists (skipped)')
  }

  // 6. gift card — generate a raw code, hash under the pepper, store codeHash + lastFour + cached
  //    balance, and write the 'issue' ledger entry so balance + ledger agree. Show the raw code ONCE.
  //    Skipped (with a warning) when the pepper is unset OR a card already exists for the tenant.
  const giftAmount = Number(process.env.COMMERCE_PROVISION_GIFT_CARD_AMOUNT ?? 10000)
  const alreadyHasGiftCard = await exists(payload, 'gift-cards', { tenant: { equals: tenantId } })
  if (alreadyHasGiftCard) {
    note('  gift card: already exists for tenant (skipped — raw code cannot be re-shown)')
  } else {
    try {
      const pepper = resolveGiftCardPepper() // throws GiftCardPepperError if unset/malformed
      const rawCode = `DGH-${randomBytes(2).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`
      const normalized = normalizeGiftCardCode(rawCode)
      const codeHash = createHmac('sha256', Buffer.from(pepper)).update(normalized, 'utf8').digest('hex')
      const lastFour = normalized.slice(-4)
      const gc = await payload.create({
        collection: 'gift-cards', overrideAccess: true,
        data: { tenant: tenantId, codeHash, lastFour, currency, initialBalance: giftAmount, balance: giftAmount, status: 'active' } as any,
      })
      await payload.create({
        collection: 'gift-card-ledger', overrideAccess: true,
        data: { tenant: tenantId, giftCard: gc.id, kind: 'issue', amount: giftAmount, idempotencyKey: `provision-issue-${gc.id}`, createdAt: nowIso() } as any,
      })
      note(`  gift card: issued …${lastFour} (${(giftAmount / 100).toFixed(2)} ${currency}). RAW CODE (shown once, never stored): ${rawCode}`)
    } catch (err) {
      note(`  gift card: SKIPPED — ${(err as Error).message} (set COMMERCE_GIFT_CARD_PEPPER to a base64 ≥32-byte value to issue one)`)
    }
  }

  // Report the tenant feature-flag state. The script does NOT enable commerce.
  const tenant = (await findOne(payload, 'tenants', { slug: { equals: slug } })) as { features?: string[] | null } | undefined
  const features = tenant?.features ?? []
  note(`  features: [${features.join(', ')}]${features.includes('commerce') ? ' (commerce ON)' : ' (commerce OFF — enable via the tenant to go live)'}`)

  process.stdout.write('\nProvisioning summary:\n' + log.join('\n') + '\n')
  await (payload as unknown as { destroy?: () => Promise<void> }).destroy?.()
}

main().catch((err) => {
  process.stderr.write(`provision-commerce-tenant failed: ${(err as Error).stack || String(err)}\n`)
  process.exit(1)
})

// Shared fixtures for commerce integration tests. Each test runs against an isolated throwaway
// SQLite DB (temp file), migrated from scratch, so the versioned migrations double as SQL validation.
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type PayloadLike = {
  create: (args: any) => Promise<any>
  find: (args: any) => Promise<any>
  findByID: (args: any) => Promise<any>
  update: (args: any) => Promise<any>
  db: { migrate: () => Promise<void>; drizzle: any }
  destroy: () => Promise<void>
}

export function tempDbPath(label: string): string {
  return join(tmpdir(), `${label}-${process.pid}-${Date.now()}.db`)
}

let counter = 0
const unique = () => `${process.pid}-${Date.now()}-${counter++}`

export async function seedTenant(
  payload: PayloadLike,
  opts: { features?: string[]; slug?: string } = {},
) {
  const features = opts.features ?? ['commerce']
  const suffix = unique()
  const tt = await payload.create({
    collection: 'tenant-types',
    overrideAccess: true,
    data: { slug: `type-${suffix}`, name: 'Type', defaultFeatures: features },
  })
  const tenant = await payload.create({
    collection: 'tenants',
    overrideAccess: true,
    data: {
      name: `Tenant ${suffix}`,
      slug: opts.slug ?? `tenant-${suffix}`,
      type: tt.id,
      features,
      hero: {
        years: { value: '1' },
        departments: { value: '1' },
        patients: { value: '1' },
        staff: { value: '1' },
      },
    },
  })
  return { tenantId: tenant.id, tenantTypeId: tt.id }
}

export async function seedLocation(
  payload: PayloadLike,
  tenantId: number | string,
  name = 'Warehouse',
) {
  const loc = await payload.create({
    collection: 'inventory-locations',
    overrideAccess: true,
    data: { name, slug: `loc-${unique()}`, tenant: tenantId },
  })
  return loc.id
}

export async function seedLevel(
  payload: PayloadLike,
  tenantId: number | string,
  locationId: number | string,
  sku: string,
  onHand: number,
) {
  const level = await payload.create({
    collection: 'inventory-levels',
    overrideAccess: true,
    data: { location: locationId, sku, onHand, tenant: tenantId },
  })
  return level.id
}

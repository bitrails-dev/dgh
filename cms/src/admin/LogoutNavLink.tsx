'use client'

import { Link, useConfig, useTranslation } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'

export default function LogoutNavLink() {
  const { config } = useConfig()
  const { t } = useTranslation()
  const href = formatAdminURL({
    adminRoute: config.routes.admin,
    path: config.admin.routes.logout,
  })

  return (
    <Link
      href={href}
      prefetch={false}
      style={{ display: 'block', fontWeight: 600, padding: 'calc(var(--base) / 2) var(--base)' }}
    >
      {t('authentication:logOut')}
    </Link>
  )
}

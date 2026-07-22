// Swappable notification transport (Plan §7 E1).
//
// The default transport is SMTP via nodemailer (already resolvable in this repo — a transitive dep
// of @payloadcms/email-nodemailer). It is SAFE TO CALL BEFORE SMTP IS CONFIGURED: when
// `COMMERCE_SMTP_HOST` is unset, `send` returns a structured `{ ok: true, transport: 'unconfigured' }`
// result so the `send-commerce-notification` task SUCCEEDS and payment events can reach `processed=1`.
// The operator wires real SMTP later via env (declared in the Wave E handoff for .env.example).
//
// nodemailer is imported lazily inside `send`, so the unconfigured path never loads it. No raw
// secrets or raw provider payloads are persisted here — credentials live only in env, and only the
// message envelope (subject/body + non-sensitive meta) is handed to the transporter.

import type { NotificationMessage, NotificationSendResult, NotificationTransport } from './types'

export interface SmtpTransportConfig {
  host?: string
  port?: number
  secure?: boolean
  user?: string
  pass?: string
  from?: string
}

/**
 * Read the SMTP transport config from env (once). Returns `null` when the host is unset → callers
 * use the no-op "unconfigured" transport and the task succeeds without sending.
 */
export function readSmtpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SmtpTransportConfig {
  const portRaw = env.COMMERCE_SMTP_PORT
  const port = portRaw ? Number(portRaw) : undefined
  return {
    host: env.COMMERCE_SMTP_HOST?.trim() || undefined,
    port: port != null && Number.isFinite(port) ? port : undefined,
    secure: String(env.COMMERCE_SMTP_SECURE).toLowerCase() === 'true',
    user: env.COMMERCE_SMTP_USER?.trim() || undefined,
    pass: env.COMMERCE_SMTP_PASS,
    from: env.COMMERCE_SMTP_FROM?.trim() || undefined,
  }
}

// A cached nodemailer transporter. Built on first real send; reused thereafter. `undefined` means
// "not built yet"; `null` means "host unconfigured — send is a structured no-op".
let cachedTransporter: unknown | null | undefined = undefined
let cachedConfigKey = ''

async function getSmtpTransporter(config: SmtpTransportConfig): Promise<unknown> {
  // Cache by the (non-secret) connection signature so rotating credentials via env picks up a new
  // transporter without a process restart.
  const key = `${config.host}:${config.port ?? ''}:${config.secure ? '1' : '0'}:${config.user ?? ''}`
  if (cachedTransporter !== undefined && key === cachedConfigKey) return cachedTransporter
  // Lazy import: the unconfigured path never loads nodemailer.
  const nodemailer = (await import('nodemailer')).default ?? (await import('nodemailer'))
  const transporter = (nodemailer as {
    createTransport: (opts: unknown) => unknown
  }).createTransport({
    host: config.host,
    port: config.port ?? 587,
    secure: config.secure ?? false,
    auth: config.user ? { user: config.user, pass: config.pass } : undefined,
  })
  cachedTransporter = transporter
  cachedConfigKey = key
  return transporter
}

/**
 * Build the default transport from env. When `COMMERCE_SMTP_HOST` is unset, `send` is a structured
 * no-op that succeeds with `transport: 'unconfigured'`. When SMTP IS configured but a send fails,
 * the result distinguishes transient (retryable) from permanent (non-retryable) failures so the
 * engine can throw on the former and record a structured skip on the latter.
 */
export function createSmtpTransport(
  config: SmtpTransportConfig = readSmtpConfigFromEnv(),
  log: (line: string) => void = () => {},
): NotificationTransport {
  return {
    name: 'smtp',
    async send(message: NotificationMessage): Promise<NotificationSendResult> {
      if (!config.host) {
        // Safe-to-call-before-configured path. The task SUCCEEDS here — this is what lets payment
        // events reach processed=1 before SMTP is wired.
        log(`[commerce-notify] unconfigured: skipping ${message.template} to <${redact(message.to)}> (tenant ${message.tenantId})`)
        return { ok: true, transport: 'unconfigured', retryable: false }
      }
      if (!config.from) {
        // SMTP host set but no From address → misconfiguration. Non-retryable until fixed; do not
        // burn Payload's retry budget on it.
        return { ok: false, transport: 'smtp', reason: 'missing COMMERCE_SMTP_FROM', retryable: false }
      }
      try {
        const transporter = await getSmtpTransporter(config)
        // The subject + plaintext body carry per-locale strings. Pick the recipient's preferred locale
        // when the message carries one; default to 'en' if absent. The HTML body is left bilingual
        // (ar block + en block) per existing convention.
        const loc = ((message as NotificationMessage & { locale?: 'ar' | 'en' }).locale === 'ar') ? 'ar' : 'en'
        const info = await (transporter as {
          sendMail: (m: unknown) => Promise<{ messageId?: string } | { messageID?: string }>
        }).sendMail({
          from: config.from,
          to: message.to,
          subject: message.subject[loc] ?? message.subject.en,
          text: message.body[loc] ?? message.body.en,
          // Bilingual: ar in the HTML body (default locale), en appended below.
          html: `<div dir="rtl" lang="ar"><p>${escapeHtml(message.body.ar)}</p></div><hr/><div lang="en"><p>${escapeHtml(message.body.en)}</p></div>`,
        })
        const messageId = (info as { messageId?: string; messageID?: string }).messageId ?? (info as { messageID?: string }).messageID
        return { ok: true, transport: 'smtp', messageId, retryable: false }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err)
        // Heuristic: connection / auth / envelope errors are retryable; malformed-message and auth
        // reject are not. Nodemailer surfaces most transient errors with these substrings.
        const retryable = /timeout|connect|network|ECONN|EAI|ETIMEDOUT|ENOTFOUND|queue|greylist|temporarily|4\d\d/i.test(reason)
        return { ok: false, transport: 'smtp', reason, retryable }
      }
    },
  }
}

// The recipient address is lightly redacted in logs so an operator can see which tenant/template
// fired without capturing the full mailbox in plain log lines.
function redact(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const head = local.slice(0, Math.min(2, local.length))
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`
}

// Escapes & < > " '. Safe for both text-content AND attribute contexts (e.g. a future link href /
// data-* attribute built from a meta value would need quote-escaping to avoid an attribute breakout).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

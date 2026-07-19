// Per-trigger content rendering for durable commerce notifications (Plan §7 E1).
//
// Pure: input + resolved recipient → a bilingual (ar default / en) message, or a typed skip outcome.
// This wave ships the durable PLUMBING, not a content overhaul — copy is minimal, factual, and
// placeholder-driven. ar is the default locale per the project convention; en is provided alongside.
//
// The payment path folds a provider event into a PaymentState before enqueuing; this module maps
// each folded state to a concrete template. States with no user-facing message (pending,
// authorized, partially_captured, disputed) intentionally return a `skip` outcome so the task
// succeeds without sending — the notification checkpoint already returned ok at enqueue time, and
// these interim states would only spam the customer.

import type { PaymentState } from '../payments/state'
import type {
  NotificationMessage,
  NotificationTaskInput,
  NotificationTemplate,
} from './types'

export type RenderOutcome =
  | { ok: true; recipientEmail: string; message: NotificationMessage }
  | { ok: false; skip: true; reason: string }

// Map a folded payment state to its content template. Terminal/interesting states produce a
// template; interim states produce null (skip). `cancelled` is not a PaymentState (it is a
// fulfillment / order-status value), so it is not handled here.
export function paymentStateTemplate(state: PaymentState | undefined | null): NotificationTemplate | null {
  switch (state) {
    case 'captured':
      return 'payment_captured'
    case 'failed':
      return 'payment_failed'
    case 'refunded':
    case 'partially_refunded':
      return 'refund_completed'
    default:
      // pending / authorized / partially_captured / voided / disputed / unknown → no customer message.
      return null
  }
}

function formatMinor(amount: number | null | undefined): string {
  // Display as a decimal with 2 fractional digits (EGP). The persisted value stays integer minor
  // units everywhere else; this is a presentation-only conversion for the message body.
  const minor = Math.trunc(Number(amount ?? 0)) || 0
  const sign = minor < 0 ? '-' : ''
  const abs = Math.abs(minor)
  const pounds = Math.trunc(abs / 100)
  const piasters = abs % 100
  return `${sign}${pounds}.${piasters.toString().padStart(2, '0')}`
}

/**
 * Resolve a notification input to a transport-ready message. Returns a `skip` outcome when:
 *   - the trigger/state has no customer-facing template (interim payment states);
 *   - no recipient email is available (the caller may still succeed the task — see engine.ts).
 */
export function renderNotification(
  input: NotificationTaskInput,
  recipientEmail: string | null | undefined,
): RenderOutcome {
  const tenantId = input.tenantId
  const to = (recipientEmail ?? '').trim()
  switch (input.trigger) {
    case 'payment_event': {
      const template = paymentStateTemplate(input.state)
      if (!template) return { ok: false, skip: true, reason: `no_template_for_state:${input.state ?? 'none'}` }
      if (!to) return { ok: false, skip: true, reason: 'no_recipient' }
      return { ok: true, recipientEmail: to, message: paymentMessage(input, template, to, tenantId) }
    }
    case 'order_placed': {
      if (!to) return { ok: false, skip: true, reason: 'no_recipient' }
      const orderNumber = input.orderNumber ?? ''
      const amount = formatMinor(input.amountDue)
      return {
        ok: true,
        recipientEmail: to,
        message: {
          to, tenantId, trigger: 'order_placed', template: 'order_placed',
          subject: {
            ar: `تم استلام طلبك ${orderNumber}`,
            en: `We received your order ${orderNumber}`,
          },
          body: {
            ar: `شكراً لك. تم تسجيل طلبك رقم ${orderNumber} بقيمة ${amount} ج.م. سنخبرك فور تأكيد الدفع.`,
            en: `Thank you. Your order ${orderNumber} for ${amount} EGP has been received. We will notify you once payment is confirmed.`,
          },
          meta: { orderNumber, amount: input.amountDue },
        },
      }
    }
    case 'order_cancelled': {
      if (!to) return { ok: false, skip: true, reason: 'no_recipient' }
      const orderNumber = input.orderNumber ?? ''
      return {
        ok: true,
        recipientEmail: to,
        message: {
          to, tenantId, trigger: 'order_cancelled', template: 'order_cancelled',
          subject: {
            ar: `تم إلغاء طلبك ${orderNumber}`,
            en: `Your order ${orderNumber} was cancelled`,
          },
          body: {
            ar: `تم إلغاء طلبك رقم ${orderNumber}. إذا كان لديك أي مبلغ مدفوع، فسيتم استرجاعه وفقاً لسياسة الاسترجاع.`,
            en: `Your order ${orderNumber} has been cancelled. Any amount paid will be refunded according to the refund policy.`,
          },
          meta: { orderNumber },
        },
      }
    }
    case 'account_verification':
    case 'password_reset': {
      if (!to) return { ok: false, skip: true, reason: 'no_recipient' }
      // The token is opaque and forwarded only inside the message meta for the transport/UI to turn
      // into a link. It is never logged elsewhere.
      const template: NotificationTemplate = input.trigger
      const isVerify = input.trigger === 'account_verification'
      return {
        ok: true,
        recipientEmail: to,
        message: {
          to, tenantId, trigger: input.trigger, template,
          subject: isVerify
            ? { ar: 'تأكيد بريدك الإلكتروني', en: 'Confirm your email' }
            : { ar: 'إعادة تعيين كلمة المرور', en: 'Reset your password' },
          body: isVerify
            ? {
                ar: 'استخدم الرمز المرفق لتأكيد بريدك الإلكتروني وإكمال إنشاء حسابك. ينتهي خلال وقت قصير.',
                en: 'Use the attached token to confirm your email and finish creating your account. It expires shortly.',
              }
            : {
                ar: 'تلقينا طلباً لإعادة تعيين كلمة المرور. استخدم الرمز المرفق للمتابعة. إذا لم تكن أنت، تجاهل هذه الرسالة.',
                en: 'We received a request to reset your password. Use the attached token to proceed. If this was not you, ignore this message.',
              },
          meta: { /* token intentionally NOT placed in meta — it rides only in the message envelope */ },
        },
      }
    }
    default:
      return { ok: false, skip: true, reason: `unknown_trigger:${input.trigger as string}` }
  }
}

function paymentMessage(
  input: NotificationTaskInput,
  template: NotificationTemplate,
  to: string,
  tenantId: number | string,
): NotificationMessage {
  const orderNumber = input.orderNumber ?? ''
  const amount = formatMinor(input.amount)
  const common = {
    to, tenantId, trigger: 'payment_event' as const,
    meta: {
      orderNumber,
      amount: input.amount ?? null,
      gateway: input.gateway,
      providerEventId: input.providerEventId,
    },
  }
  switch (template) {
    case 'payment_captured':
      return {
        ...common, template,
        subject: { ar: `تم تأكيد دفع طلبك ${orderNumber}`, en: `Payment confirmed for order ${orderNumber}` },
        body: {
          ar: `تم تأكيد دفع طلبك رقم ${orderNumber}${input.amount ? ` بقيمة ${amount} ج.م` : ''}. جاري تجهيز طلبك.`,
          en: `Payment for your order ${orderNumber}${input.amount ? ` (${amount} EGP)` : ''} is confirmed. We are preparing your order.`,
        },
      }
    case 'payment_failed':
      return {
        ...common, template,
        subject: { ar: `تعذّر إتمام دفع طلبك ${orderNumber}`, en: `Payment could not be completed for order ${orderNumber}` },
        body: {
          ar: `لم نتمكن من تأكيد دفع طلبك رقم ${orderNumber}. يمكنك المحاولة مرة أخرى أو التواصل مع الدعم.`,
          en: `We could not confirm payment for your order ${orderNumber}. You can try again or contact support.`,
        },
      }
    case 'refund_completed':
      return {
        ...common, template,
        subject: { ar: `تم استرجاع مبلغ طلبك ${orderNumber}`, en: `Refund processed for order ${orderNumber}` },
        body: {
          ar: `تم معالجة استرجاع لطلبك رقم ${orderNumber}${input.amount ? ` بقيمة ${amount} ج.م` : ''}. قد يستغرق الظهور في كشف الحساب بضعة أيام.`,
          en: `A refund for your order ${orderNumber}${input.amount ? ` (${amount} EGP)` : ''} has been processed. It may take a few days to appear on your statement.`,
        },
      }
    default:
      // Unreachable: paymentStateTemplate only yields the three templates above.
      return {
        ...common, template,
        subject: { ar: `تحديث بخصوص طلبك ${orderNumber}`, en: `Update on your order ${orderNumber}` },
        body: { ar: `يوجد تحديث بخصوص طلبك رقم ${orderNumber}.`, en: `There is an update on your order ${orderNumber}.` },
      }
  }
}

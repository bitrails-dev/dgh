// Provider-agnostic payment contract. Paymob and Kashier adapters implement this interface; their
// provider-specific limits are expressed as capabilities (a provider that cannot void returns
// capabilities.voiding = false and the orchestration layer never calls void()). The orchestration
// layer, webhook handler, and state machine (state.ts) depend only on these normalized shapes, so a
// new gateway is an adapter + capability declaration, not a change to order/payment logic.
import type { Money } from '../money'
import type { PaymentState } from './state'

export interface PaymentCapabilities {
  hostedCheckout: boolean
  authorization: boolean // authorize-now-capture-later, vs immediate capture
  refunds: boolean
  partialRefunds: boolean
  voiding: boolean
  recurring: boolean // stored-token subscriptions
  webhookSignature: 'hmac' | 'rsa' | 'none'
}

// A normalized provider event — the only shape the state machine and webhook job consume.
export interface NormalizedEvent {
  provider: string
  providerEventId: string // gateway's unique id for this event; drives idempotency
  merchantReference: string // our order/payment reference
  targetState: PaymentState
  amount?: Money // captured/refunded/authorized amount when present
  rawRedacted?: unknown // sanitized provider payload (no full card, no secrets) for audit
}

export interface VerifiedWebhook {
  accepted: boolean
  event?: NormalizedEvent
  reason?: string // why it was rejected (bad signature, malformed)
}

export interface HostedCheckoutInput {
  merchantReference: string
  amount: Money
  customerEmail?: string
  billingUrl?: string
  sandbox: boolean
}

export interface HostedCheckoutResult {
  checkoutUrl: string
  providerSessionId: string
}

export interface RefundInput {
  providerTransactionId: string
  amount: Money
  reason?: string
}

export interface ProviderResult {
  ok: boolean
  providerEventId?: string
  error?: { code: string; message: string } // sanitized — never a raw gateway secret/auth blob
}

export interface PaymentAdapter {
  readonly provider: string
  capabilities(): PaymentCapabilities
  createHostedCheckout(input: HostedCheckoutInput): Promise<HostedCheckoutResult>
  refund(input: RefundInput): Promise<ProviderResult>
  void?(input: { providerTransactionId: string; reason?: string }): Promise<ProviderResult>
  // Verify raw webhook bytes + headers and return a normalized event, or a rejection reason.
  // Preserves raw bytes until verified; never returns secrets in NormalizedEvent.rawRedacted.
  verifyWebhook(input: { rawBody: Buffer; headers: Record<string, string | undefined> }): Promise<VerifiedWebhook>
  // Reconcile an ambiguous/old status directly with the provider (authoritative over webhook order).
  lookup(merchantReference: string): Promise<{ state: PaymentState; providerEventId?: string }>
}

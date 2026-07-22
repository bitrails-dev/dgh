// Commerce crypto. One responsibility: gateway-secret encryption (AES-256-GCM via social/crypto
// under purpose `payload-commerce`). Plaintext gateway secrets are never returned after save.
//
// Stateless customer session tokens (signSession/verifySession) were removed: the customer auth
// layer is now JWT-based via Payload local auth (see commerce/customers/payload-auth.ts). The dead
// HMAC exports had no callers in src or tests.

import { encryptToken, decryptToken, requirePayloadSecret } from '../social/crypto'

const PURPOSE = 'payload-commerce'

export function encryptGatewaySecret(plaintext: string): string {
  return encryptToken(plaintext, undefined, PURPOSE)
}

export function decryptGatewaySecret(blob: string): string {
  return decryptToken(blob, undefined, PURPOSE)
}

// Re-exported so callers that care only about commerce crypto can import the fail-closed guard
// without reaching into the social layer.
export { requirePayloadSecret }

// Gateway key resolver. Reads COMMERCE_GATEWAY_* env vars at call time and returns the decoded
// current key + optional previous key (for rotation). The signer (Astro side) uses only `current`;
// the verifier (CMS side) accepts both. The plan requires secrets decode to ≥32 random bytes and
// must not reuse PAYLOAD_SECRET or provider secrets — we enforce the byte length here; the "must not
// reuse" rule is an operational constraint enforced at provisioning time.
//
// Env (the integration owner wires these into .env.example / cms/.env.example — that file is
// outside this lane's allowlist):
//   COMMERCE_GATEWAY_KEY_ID            — current key identifier (string)
//   COMMERCE_GATEWAY_SECRET            — current secret, base64-encoded ≥32 random bytes
//   COMMERCE_GATEWAY_PREVIOUS_KEY_ID   — optional, rotation only
//   COMMERCE_GATEWAY_PREVIOUS_SECRET   — optional, rotation only; required if previous key id set
//
// The verifier caller decides how often to re-resolve. Resolving per request means rotation takes
// effect without a restart; the trade-off is the cost of a Buffer.from (negligible).

import type { KeyMaterial } from './types'

const MIN_SECRET_BYTES = 32

export class GatewayKeyError extends Error {}

// Decode a base64-encoded gateway secret to raw bytes. Throws GatewayKeyError if the result is
// shorter than 32 bytes (the plan's minimum). Accepts standard base64 with or without padding.
export function decodeGatewaySecret(base64: string): Uint8Array {
  let buf: Buffer
  try {
    buf = Buffer.from(base64, 'base64')
  } catch {
    throw new GatewayKeyError('Gateway secret is not valid base64.')
  }
  // Buffer.from('xxxx', 'base64') never throws — it just decodes what it can. Reject if the result
  // is too short or fully empty.
  if (buf.length < MIN_SECRET_BYTES) {
    throw new GatewayKeyError(
      `Gateway secret must decode to at least ${MIN_SECRET_BYTES} bytes (got ${buf.length}).`,
    )
  }
  // Copy into a standalone Uint8Array so the caller cannot accidentally mutate a shared pool.
  return new Uint8Array(buf)
}

export interface KeyResolverResult {
  current: KeyMaterial
  previous?: KeyMaterial
}

// Reads process.env at call time. Throws GatewayKeyError if any current key material is missing or
// malformed, or if a previous pair is half-specified (one of the two without the other). Accepts a
// broad record so tests can pass a literal object; the default is `process.env`, which is assignable
// to `Record<string, string | undefined>`.
export function resolveKeysFromEnv(
  env: Record<string, string | undefined> = process.env,
): KeyResolverResult {
  const currentKeyId = env.COMMERCE_GATEWAY_KEY_ID
  const currentSecretB64 = env.COMMERCE_GATEWAY_SECRET
  if (!currentKeyId) throw new GatewayKeyError('COMMERCE_GATEWAY_KEY_ID is not set.')
  if (!currentSecretB64) throw new GatewayKeyError('COMMERCE_GATEWAY_SECRET is not set.')
  const current: KeyMaterial = {
    keyId: currentKeyId,
    secret: decodeGatewaySecret(currentSecretB64),
  }

  const prevKeyId = env.COMMERCE_GATEWAY_PREVIOUS_KEY_ID
  const prevSecretB64 = env.COMMERCE_GATEWAY_PREVIOUS_SECRET
  if (prevKeyId || prevSecretB64) {
    if (!prevKeyId || !prevSecretB64) {
      throw new GatewayKeyError(
        'COMMERCE_GATEWAY_PREVIOUS_KEY_ID and COMMERCE_GATEWAY_PREVIOUS_SECRET must be set together.',
      )
    }
    return {
      current,
      previous: { keyId: prevKeyId, secret: decodeGatewaySecret(prevSecretB64) },
    }
  }
  return { current }
}

// Money core for commerce. All persisted and calculated money is an integer count of the smallest
// currency unit (e.g. piasters for EGP, cents for USD). Floating-point is never used for money.
//
// Rates are expressed in basis points (1% = 100 bps) so percentage math stays in exact integers
// until a single half-up division to minor units. EGP (3 decimal places in reality, 1 EGP = 100
// piasters) is the default seed currency; storage is always integer minor units regardless of the
// currency's real-world exponent.

export type Money = { amount: number; currency: string }

const CURRENCY_RE = /^[A-Z]{3}$/

// ponytail: guard at the trust boundary only. Once a Money exists it is structurally integer; we
// do not re-validate on every arithmetic op (the constructors below are the only entry points).
export function assertMoney(m: Money): void {
  if (!m || typeof m.amount !== 'number' || !Number.isSafeInteger(m.amount)) {
    throw new Error(`Money.amount must be a safe integer, got ${JSON.stringify((m as { amount?: unknown })?.amount)}`)
  }
  if (typeof m.currency !== 'string' || !CURRENCY_RE.test(m.currency)) {
    throw new Error(`Invalid ISO-4217 currency: ${JSON.stringify((m as { currency?: unknown })?.currency)}`)
  }
}

export function money(amount: number, currency: string): Money {
  const m: Money = { amount, currency: currency.toUpperCase() }
  assertMoney(m)
  return m
}

export function zero(currency: string): Money {
  return money(0, currency)
}

function requireSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`)
  }
}

export function add(a: Money, b: Money): Money {
  requireSameCurrency(a, b)
  return { amount: a.amount + b.amount, currency: a.currency }
}

export function subtract(a: Money, b: Money): Money {
  requireSameCurrency(a, b)
  return { amount: a.amount - b.amount, currency: a.currency }
}

// Multiply a unit price by an integer quantity (line total). Fractional quantities are not money.
export function scale(m: Money, factor: number): Money {
  if (!Number.isSafeInteger(factor) || factor < 0) {
    throw new Error(`scale factor must be a non-negative integer, got ${factor}`)
  }
  return { amount: m.amount * factor, currency: m.currency }
}

export function sum(parts: Money[], currency: string): Money {
  const head = { amount: 0, currency }
  assertMoney(head)
  let total = 0
  for (const part of parts) {
    requireSameCurrency(head, part)
    total += part.amount
  }
  return { amount: total, currency }
}

// Integer half-up division. q = trunc(n/d); round away from zero when 2*remainder >= denominator.
// Exact as long as n*d stay within Number.MAX_SAFE_INTEGER (true for any realistic commerce value).
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator)) {
    throw new Error(`divRoundHalfUp numerator must be a safe integer, got ${numerator}`)
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error(`divRoundHalfUp denominator must be a positive integer, got ${denominator}`)
  }
  const q = Math.trunc(numerator / denominator)
  const r = numerator - q * denominator
  const roundsUp = numerator >= 0 ? 2 * r >= denominator : -2 * r >= denominator
  return roundsUp ? q + (numerator >= 0 ? 1 : -1) : q
}

// Apply a basis-point rate (250 bps = 2.5%) with half-up rounding to minor units.
// amount * bps is computed in integers; the only division is the final half-up step.
export function applyBps(m: Money, bps: number): Money {
  if (!Number.isSafeInteger(bps) || bps < 0) {
    throw new Error(`applyBps bps must be a non-negative integer, got ${bps}`)
  }
  return { amount: divRoundHalfUp(m.amount * bps, 10_000), currency: m.currency }
}

export function isNonNegative(m: Money): boolean {
  return m.amount >= 0
}

export function isZero(m: Money): boolean {
  return m.amount === 0
}

export function greaterThan(a: Money, b: Money): boolean {
  requireSameCurrency(a, b)
  return a.amount > b.amount
}

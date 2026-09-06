/**
 * Server-Side Request Forgery (SSRF) guard (OWASP A10).
 *
 * The app's outbound fetches target either fixed hosts (Stripe, Google APIs)
 * or operator-configured URLs (web search, MCP servers, diagram/weather
 * providers). This module validates the operator-configured ones before the
 * first request: only http/https, no private, loopback, link-local, or
 * reserved IPs, and a DNS lookup that rejects a hostname if ANY resolved
 * address is blocked (a DNS-rebinding attempt can't hide a private answer
 * behind a public first address).
 *
 * Deliberately NOT applied to the LLM base URL (`OPENAI_BASE_URL` /
 * `OPENROUTER_*`): self-hosted local models (e.g. Ollama on 127.0.0.1) are a
 * legitimate deployment, and that URL is operator configuration, not
 * attacker input.
 *
 * Residual risk (documented): the check resolves the hostname and the caller
 * then fetches it, so a hostname could theoretically be re-pointed between
 * the check and the request. Fully pinning would require replacing the
 * hostname with a validated IP (which breaks TLS SNI); for operator-configured
 * endpoints this window is acceptable. Redirect hops are NOT residual — the
 * `safeFetch` companion re-runs the guard on every `Location` it follows.
 */

import { lookup } from 'node:dns/promises'

/* ------------------------------------------------------------------ */
/* IP classification                                                   */
/* ------------------------------------------------------------------ */

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true // malformed — treat as unsafe rather than allowing it through
  }
  const a = parts[0]!
  const b = parts[1]!
  const c = parts[2]!
  // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.0.0.0/24 (IETF
  // protocol assignments — not 192.0.2.0/24 TEST-NET), 192.168/16,
  // 198.18/15, 100.64/10 (CGNAT), and the multicast/reserved top blocks.
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  )
}

/** Convert raw IPv6 groups to hextets, supporting dotted-quad IPv4-in-IPv6. */
function toHextets(raw: string[]): number[] | null {
  const groups: number[] = []
  for (const part of raw) {
    if (part.includes('.')) {
      // IPv4-in-IPv6 tail (e.g. `::ffff:8.8.8.8` or `::192.168.0.1`).
      const octets = part.split('.').map(Number)
      if (octets.length !== 4 || octets.some((o) => Number.isNaN(o) || o < 0 || o > 255)) {
        return null
      }
      groups.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!)
    } else {
      const group = parseInt(part, 16)
      if (Number.isNaN(group) || group < 0 || group > 0xffff) return null
      groups.push(group)
    }
  }
  return groups
}

/** Expand an IPv6 address (with or without `::`) into 8 hextets; null when invalid. */
function parseIpv6(addr: string): number[] | null {
  let value = addr
  const zoneIndex = value.indexOf('%')
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex)

  const parts = value.split('::')
  if (parts.length > 2) return null
  const hasDoubleColon = parts.length === 2
  const headParts = parts[0] ? parts[0].split(':') : []
  const tailParts = hasDoubleColon ? (parts[1] ? parts[1].split(':') : []) : null

  const head = toHextets(headParts)
  if (!head) return null
  if (!hasDoubleColon) {
    return head.length === 8 ? head : null
  }
  const tail = toHextets(tailParts ?? [])
  if (!tail) return null
  const missing = 8 - head.length - tail.length
  if (missing < 1) return null
  return [...head, ...Array(missing).fill(0), ...tail]
}

/**
 * IPv4-carried IPv6 → dotted-quad, else null. Covers:
 *  - IPv4-mapped `::ffff:a.b.c.d` (RFC 4291) and the obsolete IPv4-compatible
 *    `::a.b.c.d` — marker hextet in position 5, quad in the trailing two.
 *  - IPv4-translated `::ffff:0:a.b.c.d` (RFC 6052 general mapped form) — the
 *    marker sits in position 4 with a single zero in 5; WITHOUT this form a
 *    translated private address like `::ffff:0:127.0.0.1` slips through.
 */
function ipv4FromMappedIpv6(groups: number[]): string | null {
  if (groups.length !== 8) return null
  const quad = `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`
  if (groups.slice(0, 5).every((group) => group === 0)) {
    const marker = groups[5]
    if (marker === 0xffff || marker === 0) return quad
  }
  if (groups.slice(0, 4).every((group) => group === 0) && groups[4] === 0xffff && groups[5] === 0) {
    return quad
  }
  return null
}

function isBlockedIpv6(addr: string): boolean {
  const groups = parseIpv6(addr)
  if (!groups) return true // malformed — treat as unsafe
  const embedded = ipv4FromMappedIpv6(groups)
  if (embedded && isBlockedIpv4(embedded)) return true
  const g0 = groups[0]!
  // 64:ff9b::/96 — the IETF well-known NAT64 discovery prefix (RFC 6052).
  // Any address under it is translated through a gateway to an embedded IPv4,
  // so the whole prefix is unusable as an external destination.
  if (g0 === 0x0064 && groups[1] === 0xff9b) return true
  // :: and ::1
  if (groups.every((group) => group === 0)) return true
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true
  // fc00::/7 (unique local) and fe80::/10 (link-local)
  if ((g0 & 0xfe00) === 0xfc00) return true
  if ((g0 & 0xffc0) === 0xfe80) return true
  // Multicast ff00::/8
  if ((g0 & 0xff00) === 0xff00) return true
  return false
}

/** True when `ip` is loopback, private, link-local, reserved, or malformed. */
export function isBlockedIp(ip: string): boolean {
  if (ip.includes(':')) return isBlockedIpv6(ip)
  return isBlockedIpv4(ip)
}

/* ------------------------------------------------------------------ */
/* URL validation                                                      */
/* ------------------------------------------------------------------ */

export type SafeUrlResult = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * Validate that `raw` is an http(s) URL pointing at a public, non-private
 * destination. Resolves the hostname and blocks the URL when ANY address is
 * private/loopback/link-local/reserved, or the hostname fails to resolve.
 */
export async function assertSafeUrl(raw: string): Promise<SafeUrlResult> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'URL is malformed.' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Protocol "${url.protocol}" is not allowed.` }
  }

  const hostname = url.hostname
  // IP-literal URLs: reject immediately without a lookup. WHATWG URLs keep
  // the brackets on IPv6 hostnames ([::1]) — strip them for the classifier.
  const ipHostname = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname
  const looksLikeIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(ipHostname) || ipHostname.includes(':')
  if (looksLikeIp) {
    return isBlockedIp(ipHostname)
      ? { ok: false, reason: 'URL points at a blocked IP range.' }
      : { ok: true, url }
  }

  // Hostname: resolve all addresses and reject if any is blocked (DNS
  // rebinding can't hide a private record behind a public one).
  let addresses: Array<{ address: string }>
  try {
    addresses = await lookup(hostname, { all: true })
  } catch {
    return { ok: false, reason: 'Hostname could not be resolved.' }
  }
  if (addresses.length === 0) return { ok: false, reason: 'Hostname resolved to no addresses.' }
  if (addresses.some((entry) => isBlockedIp(entry.address))) {
    return { ok: false, reason: 'URL resolves to a blocked IP range.' }
  }
  return { ok: true, url }
}

/* ------------------------------------------------------------------ */
/* Redirect-guarded fetch                                              */
/* ------------------------------------------------------------------ */

/** Thrown when a guarded fetch hits an unsafe destination or redirect chain. */
export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const SAFE_FETCH_MAX_REDIRECTS = 3

/**
 * Fetch with the SSRF guard applied to every hop.
 *
 * A bare `fetch` validates only the first URL — a 3xx to a private/loopback
 * target is followed unconditionally, turning an operator-configured endpoint
 * into an SSRF pivot. `safeFetch` runs the request with `redirect: 'manual'`,
 * re-validates each `Location` via `assertSafeUrl` (resolving relative
 * redirects against the current URL), and follows at most 3 hops. 303s (and
 * browser-style 301/302 POST rewrites) are degraded to a bodyless GET, as
 * fetch would do. A blocked or unbounded chain throws `SafeFetchError` so the
 * caller's error path (a tool fallback / connection failure) handles it.
 */
export async function safeFetch(raw: string, init: RequestInit = {}): Promise<Response> {
  let current = raw
  let method = (init.method ?? 'GET').toUpperCase()
  let body = init.body

  for (let hop = 0; hop <= SAFE_FETCH_MAX_REDIRECTS; hop++) {
    const safe = await assertSafeUrl(current)
    if (!safe.ok) {
      throw new SafeFetchError(`Redirect target rejected: ${safe.reason}`)
    }
    const response = await fetch(safe.url, {
      ...init,
      method,
      body,
      redirect: 'manual',
    })

    if (!REDIRECT_STATUSES.has(response.status)) return response
    const location = response.headers.get('location')
    if (!location) return response
    const next = new URL(location, safe.url.toString())

    // RFC 7231 redirect semantics: 303 always becomes GET; 301/302 rewrite a
    // POST/PUT/PATCH to GET, exactly as global fetch does when following.
    const rewriteToGet =
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) &&
        method !== 'GET' &&
        method !== 'HEAD')
    if (rewriteToGet) {
      method = 'GET'
      body = undefined
    }
    current = next.toString()
  }

  throw new SafeFetchError('Too many redirects.')
}

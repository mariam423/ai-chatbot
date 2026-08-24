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
 * endpoints this window is acceptable.
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

/** IPv4-mapped IPv6 (`::ffff:a.b.c.d` / `::a.b.c.d`) → dotted-quad, else null. */
function ipv4FromMappedIpv6(groups: number[]): string | null {
  if (groups.length !== 8) return null
  const headZero = groups.slice(0, 5).every((group) => group === 0)
  if (!headZero) return null
  const marker = groups[5]
  if (marker !== 0xffff && marker !== 0) return null
  return `${groups[6]! >> 8}.${groups[6]! & 0xff}.${groups[7]! >> 8}.${groups[7]! & 0xff}`
}

function isBlockedIpv6(addr: string): boolean {
  const groups = parseIpv6(addr)
  if (!groups) return true // malformed — treat as unsafe
  const embedded = ipv4FromMappedIpv6(groups)
  if (embedded && isBlockedIpv4(embedded)) return true
  const g0 = groups[0]!
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

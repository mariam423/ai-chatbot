import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}))

import { lookup } from 'node:dns/promises'
import { assertSafeUrl, isBlockedIp } from '../lib/ssrf'

// `lookup` is overloaded (single-address vs { all: true } → array), so vi.mocked
// picks the wrong resolved type — cast to a plain fn and drive it with arrays.
const lookupMock = vi.mocked(lookup) as unknown as ReturnType<typeof vi.fn>

afterEach(() => {
  lookupMock.mockReset()
})

describe('isBlockedIp (OWASP A10 range blocking)', () => {
  it('blocks loopback, private, link-local, CGNAT, and reserved IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '127.8.8.8',
      '10.0.0.1',
      '10.255.255.255',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '192.168.255.255',
      '169.254.1.1',
      '0.0.0.0',
      '100.64.0.1',
      '100.127.255.255',
      '198.18.0.1',
      '198.19.255.255',
      '224.0.0.1',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4 ranges (and the boundary just outside 172.16/12)', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '192.0.2.1']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it('blocks loopback, ULA, link-local, multicast, and IPv4-mapped IPv6', () => {
    for (const ip of [
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      'fc00::1',
      'fd12:3456:789a::1',
      'fe80::1',
      'ff02::1',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6 and IPv4-mapped public addresses', () => {
    for (const ip of ['2001:4860:4860::8888', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })

  it('treats malformed addresses as unsafe', () => {
    expect(isBlockedIp('999.1.1.1')).toBe(true)
    expect(isBlockedIp('not-an-ip')).toBe(true)
    expect(isBlockedIp('fe80')).toBe(true)
  })
})

describe('assertSafeUrl', () => {
  it('rejects non-http(s) protocols without a lookup', async () => {
    for (const raw of ['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)']) {
      const result = await assertSafeUrl(raw)
      expect(result.ok).toBe(false)
      expect(lookupMock).not.toHaveBeenCalled()
    }
  })

  it('rejects malformed URLs', async () => {
    const result = await assertSafeUrl('not a url')
    expect(result.ok).toBe(false)
  })

  it('rejects private IP literals without a lookup', async () => {
    for (const raw of [
      'http://127.0.0.1',
      'http://10.0.0.1/x',
      'http://192.168.1.1',
      'http://[::1]/',
    ]) {
      const result = await assertSafeUrl(raw)
      expect(result.ok).toBe(false)
      expect(lookupMock).not.toHaveBeenCalled()
    }
  })

  it('accepts public IP literals', async () => {
    const result = await assertSafeUrl('http://8.8.8.8/ping')
    expect(result.ok).toBe(true)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('resolves hostnames and allows public addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const result = await assertSafeUrl('https://example.com/path')
    expect(result.ok).toBe(true)
    expect(lookupMock).toHaveBeenCalledWith('example.com', { all: true })
  })

  it('blocks a hostname that resolves to a private address (localhost)', async () => {
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const result = await assertSafeUrl('http://localhost/x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('blocked')
  })

  it('blocks a hostname when ANY resolved address is private (DNS rebinding)', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ])
    const result = await assertSafeUrl('https://mixed.example/x')
    expect(result.ok).toBe(false)
  })

  it('blocks unresolvable hostnames', async () => {
    lookupMock.mockRejectedValue(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }))
    const result = await assertSafeUrl('https://no-such-host.invalid/x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('could not be resolved')
  })

  it('blocks IPv6-mapped private hostnames', async () => {
    lookupMock.mockResolvedValue([{ address: '::ffff:192.168.0.5', family: 6 }])
    const result = await assertSafeUrl('https://mapped.example/x')
    expect(result.ok).toBe(false)
  })
})

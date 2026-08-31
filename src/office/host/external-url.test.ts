import { describe, expect, it } from 'vitest'
import { safeExternalUrl, safeOfficeHref } from './external-url'

describe('Office hyperlink validation', () => {
  it('allows external user-facing schemes and normalizes them', () => {
    expect(safeExternalUrl(' https://example.com/report ')).toBe('https://example.com/report')
    expect(safeExternalUrl('mailto:owner@example.com')).toBe('mailto:owner@example.com')
    expect(safeExternalUrl('tel:+15551234567')).toBe('tel:+15551234567')
  })

  it('rejects executable, local, and relative URLs', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull()
    expect(safeExternalUrl('data:text/html,unsafe')).toBeNull()
    expect(safeExternalUrl('file:///etc/passwd')).toBeNull()
    expect(safeExternalUrl('/relative')).toBeNull()
  })

  it('allows document fragments without treating them as external URLs', () => {
    expect(safeOfficeHref('#appendix-a')).toBe('#appendix-a')
    expect(safeOfficeHref('javascript:alert(1)')).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import { DEFAULT_USER_ROLE, normalizeUserRole, UserRoleSchema } from '../lib/roles'

describe('user roles', () => {
  it('uses FREE as the least-privilege default and accepts the supported roles', () => {
    expect(DEFAULT_USER_ROLE).toBe('FREE')
    expect(UserRoleSchema.safeParse('FREE').success).toBe(true)
    expect(UserRoleSchema.safeParse('PRO').success).toBe(true)
    expect(UserRoleSchema.safeParse('ADMIN').success).toBe(true)
  })

  it('preserves elevated roles and downgrades legacy or invalid values safely', () => {
    expect(normalizeUserRole('ADMIN')).toBe('ADMIN')
    expect(normalizeUserRole('PRO')).toBe('PRO')
    expect(normalizeUserRole('USER')).toBe('FREE')
    expect(normalizeUserRole('moderator')).toBe('FREE')
    expect(normalizeUserRole(null)).toBe('FREE')
  })
})

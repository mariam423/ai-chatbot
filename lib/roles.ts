import { z } from 'zod'

/** Application roles persisted on users and carried in Auth.js sessions. */
export const UserRoleSchema = z.enum(['FREE', 'PRO', 'ADMIN'])
export type UserRole = z.infer<typeof UserRoleSchema>

/** Normalize legacy or malformed stored roles without granting privileges. */
export function normalizeUserRole(value: string | null | undefined): UserRole {
  return UserRoleSchema.safeParse(value).success ? (value as UserRole) : 'FREE'
}

/** Role used for a newly registered or unsubscribed account. */
export const DEFAULT_USER_ROLE: UserRole = 'FREE'

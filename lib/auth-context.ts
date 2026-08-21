import { auth } from '@/lib/auth'

/**
 * Extract the authenticated user's id from the NextAuth session.
 *
 * Returns `null` when:
 * - AUTH_DISABLED=true (e2e tests, local dev)
 * - The request has no valid session cookie
 *
 * Server actions should call this at the top and bail with an unauthorized
 * error when it returns null.
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (process.env.AUTH_DISABLED === 'true') return null
  const session = await auth()
  return (session?.user as { id?: string })?.id ?? null
}

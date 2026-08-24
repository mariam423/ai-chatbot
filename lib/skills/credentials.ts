import { prisma } from '@/lib/db'
import { decryptField } from '@/lib/field-encryption'
import { parseGoogleServiceAccountKey, type SkillToolContext } from '@/lib/skills/tools'

/**
 * Resolve per-user skill-tool credentials (e.g. a Google service-account key
 * pasted in Settings) from the authenticated user's preferences. Server-only:
 * it imports lib/skills/tools.ts (node:crypto) and queries the DB.
 *
 * Returns an empty context when auth is disabled, the user has no preferences,
 * or the stored key fails to parse — tool executors then fall back to the
 * GOOGLE_* env vars and finally to the local mock path.
 */
export async function getUserSkillContext(userId: string | null): Promise<SkillToolContext> {
  if (!userId) return {}
  try {
    const pref = await prisma.userPreference.findUnique({ where: { userId } })
    // The service-account private key is stored encrypted at rest (AES-256-GCM
    // envelope); legacy plaintext rows pass through decryptField unchanged.
    const key = decryptField(pref?.googleServiceAccountKey ?? '')
    const calendarId = pref?.googleCalendarId
    if (!key || !calendarId) return {}
    const parsed = parseGoogleServiceAccountKey(key)
    if (!parsed) return {}
    return {
      googleCalendar: {
        calendarId,
        email: parsed.email,
        privateKey: parsed.privateKey,
      },
    }
  } catch {
    return {}
  }
}

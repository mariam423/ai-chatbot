import { NextResponse } from 'next/server'
import { getSkillCatalog, normalizeSkillIds } from '@/lib/skills/registry'

export const dynamic = 'force-dynamic'

/**
 * GET /api/skills — exposes the skill catalog (instructions + tools) and the
 * effective active set so the client can advertise capabilities. An optional
 * `enabledSkills` query param (comma-separated skill ids) mirrors the per-
 * session override sent with /api/chat; when absent, SKILLS_ENABLED env or
 * the full catalog applies.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const override = searchParams.has('enabledSkills')
    ? normalizeSkillIds(
        (searchParams.get('enabledSkills') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      )
    : null
  return NextResponse.json(getSkillCatalog(override))
}

import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET } from '../app/api/skills/route'

const ALL_SKILL_IDS = [
  'planning',
  'system-design',
  'frontend-ui-ux',
  'debugging',
  'testing',
  'ai-mcp',
  'docs',
  'general-utilities',
]

afterEach(() => {
  vi.unstubAllEnvs()
})

function skillsRequest(query = ''): Request {
  return new Request(`http://localhost/api/skills${query}`)
}

describe('GET /api/skills', () => {
  it('returns the full catalog with every skill active by default', async () => {
    const response = await GET(skillsRequest())
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      skills: Array<{ id: string; systemInstructions: string; toolNames: string[] }>
      tools: Array<{ name: string; parameters: { type: string } }>
      activeSkillIds: string[]
    }
    expect(body.skills).toHaveLength(8)
    expect(body.tools).toHaveLength(5)
    for (const skill of body.skills) {
      expect(skill.systemInstructions.length).toBeGreaterThan(60)
      expect(skill.toolNames.length).toBeGreaterThanOrEqual(0)
    }
    for (const tool of body.tools) {
      expect(tool.parameters.type).toBe('object')
    }
    expect(body.activeSkillIds).toEqual(ALL_SKILL_IDS)
  })

  it('narrows the active set to an enabledSkills override', async () => {
    const response = await GET(skillsRequest('?enabledSkills=planning,docs'))
    const body = (await response.json()) as { activeSkillIds: string[] }
    expect(body.activeSkillIds).toEqual(['planning', 'docs'])
  })

  it('returns no active skills for an empty override', async () => {
    const response = await GET(skillsRequest('?enabledSkills='))
    const body = (await response.json()) as { activeSkillIds: string[] }
    expect(body.activeSkillIds).toEqual([])
  })

  it('filters unknown ids and prefers the override over SKILLS_ENABLED', async () => {
    vi.stubEnv('SKILLS_ENABLED', 'planning')
    const response = await GET(skillsRequest('?enabledSkills=ghost,testing'))
    const body = (await response.json()) as { activeSkillIds: string[] }
    expect(body.activeSkillIds).toEqual(['testing'])
  })

  it('respects SKILLS_ENABLED when no override is given', async () => {
    vi.stubEnv('SKILLS_ENABLED', 'docs,testing')
    const response = await GET(skillsRequest())
    const body = (await response.json()) as { activeSkillIds: string[] }
    expect([...body.activeSkillIds].sort()).toEqual(['docs', 'testing'])
  })
})

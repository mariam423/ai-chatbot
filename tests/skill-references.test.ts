/// <reference types="vite/client" />

import { describe, it, expect } from 'vitest'
import type { AgentDefinition } from '../.agents/types/agent-definition'
import { parseFrontmatter } from './skill-utils'

// Every skill that exists on disk, keyed by frontmatter `name`.
const skillFiles = import.meta.glob('../.agents/skills/*/SKILL.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const existingSkillNames = new Set(
  Object.values(skillFiles)
    .map(parseFrontmatter)
    .map((frontmatter) => frontmatter.name)
    .filter((name): name is string => name !== undefined && name !== ''),
)

// Every agent definition in .agents/.
const agentModules = import.meta.glob('../.agents/*.ts', { eager: true }) as Record<
  string,
  { default?: AgentDefinition }
>

const agents = Object.entries(agentModules)
  .filter(([, mod]) => typeof mod.default === 'object' && mod.default !== null)
  .map(([path, mod]) => ({ path, definition: mod.default as AgentDefinition }))

// Local agent ids (e.g. `phase-planner`) are a separate namespace from
// skills — backtick-quoted mentions of them are not skill references.
const localAgentIds = new Set(agents.map(({ definition }) => definition.id))

/**
 * Extract skill references from an agent's prompt fields.
 *
 * Convention: skills are referenced as backtick-quoted kebab-case names
 * (e.g. `planner-pro-max`). Tokens that name a tool in the agent's own
 * toolNames (e.g. the `skill` tool itself) or a local agent id are not
 * skill references.
 */
function skillReferences(definition: AgentDefinition): string[] {
  const promptFields = [
    'instructionsPrompt',
    'systemPrompt',
    'stepPrompt',
    'spawnerPrompt',
  ] as const

  const refs = new Set<string>()
  for (const field of promptFields) {
    const text = definition[field]
    if (typeof text !== 'string') continue
    const backtickToken = /`([a-z0-9]+(?:-[a-z0-9]+)*)`/g
    for (const match of text.matchAll(backtickToken)) {
      const token = match[1]!
      if (definition.toolNames?.includes(token)) continue
      if (localAgentIds.has(token)) continue
      refs.add(token)
    }
  }
  return [...refs]
}

describe('skill references in agents', () => {
  it('every backtick-quoted kebab-case name in agent prompts is a real skill', () => {
    for (const { path, definition } of agents) {
      for (const ref of skillReferences(definition)) {
        expect(
          existingSkillNames.has(ref),
          `${path}: references skill \`${ref}\` which does not exist in .agents/skills/`,
        ).toBe(true)
      }
    }
  })

  it('agents that load skills name at least one in their prompts', () => {
    for (const { path, definition } of agents) {
      if (!definition.toolNames?.includes('skill')) continue
      expect(
        skillReferences(definition).length,
        `${path}: has the skill tool but never references a skill in its prompts`,
      ).toBeGreaterThan(0)
    }
  })

  describe('namespace separation', () => {
    it('agent ids and skill names do not overlap', () => {
      // Skills and agents live in different namespaces but are both
      // backtick-referenced in prompts; a shared name makes references
      // ambiguous (see the requirements-engineer rename).
      const overlaps = [...existingSkillNames].filter((name) => localAgentIds.has(name))
      expect(
        overlaps,
        overlaps.length
          ? `agent ids and skill names must be distinct; overlapping: ${overlaps.join(', ')}`
          : 'agent ids and skill names are distinct',
      ).toEqual([])
    })
  })

  it('every skill is either referenced by an agent or user-invocable', () => {
    // No dead skills: one not referenced by any agent prompt must be
    // user-invocable (user_invocable: true), and vice versa.
    const referenced = new Set(agents.flatMap(({ definition }) => skillReferences(definition)))
    for (const [path, raw] of Object.entries(skillFiles)) {
      const frontmatter = parseFrontmatter(raw)
      const name = frontmatter.name ?? ''
      const userInvocable = frontmatter.user_invocable === 'true'
      expect(
        referenced.has(name) || userInvocable,
        `${path}: skill '${name}' is neither referenced by any agent nor user-invocable`,
      ).toBe(true)
    }
  })
})

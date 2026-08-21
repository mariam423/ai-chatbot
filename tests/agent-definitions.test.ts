/// <reference types="vite/client" />

import { describe, it, expect } from 'vitest'
import type { AgentDefinition } from '../.agents/types/agent-definition'

// Eagerly load every agent definition in .agents/ (excluding types/).
const modules = import.meta.glob('../.agents/*.ts', { eager: true }) as Record<
  string,
  { default?: AgentDefinition }
>

const definitions = Object.entries(modules)
  .filter(([, mod]) => typeof mod.default === 'object' && mod.default !== null)
  .map(([path, mod]) => ({
    path,
    definition: mod.default as AgentDefinition,
  }))

describe('agent definitions', () => {
  it('has at least one agent', () => {
    expect(definitions.length).toBeGreaterThan(0)
  })

  describe('id conventions', () => {
    it('ids match ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens)', () => {
      for (const { path, definition } of definitions) {
        expect(definition.id, `${path}: invalid id`).toMatch(/^[a-z0-9-]+$/)
      }
    })

    it('ids are unique', () => {
      const ids = definitions.map(({ definition }) => definition.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('file names match the agent id (<id>.ts)', () => {
      for (const { path, definition } of definitions) {
        const fileName = path.split('/').pop()
        expect(fileName, `${path}: filename should match id`).toBe(`${definition.id}.ts`)
      }
    })
  })

  describe('required fields', () => {
    it('has a non-empty displayName', () => {
      for (const { path, definition } of definitions) {
        expect(definition.displayName.trim(), `${path}`).not.toBe('')
      }
    })

    it('has a non-empty model', () => {
      for (const { path, definition } of definitions) {
        expect(definition.model.trim(), `${path}`).not.toBe('')
      }
    })

    it('has a non-empty instructionsPrompt or systemPrompt', () => {
      for (const { path, definition } of definitions) {
        const hasInstructions = (definition.instructionsPrompt ?? '').trim() !== ''
        const hasSystem = (definition.systemPrompt ?? '').trim() !== ''
        expect(
          hasInstructions || hasSystem,
          `${path}: provide instructionsPrompt or systemPrompt`,
        ).toBe(true)
      }
    })
  })

  describe('toolNames', () => {
    it('is an array of non-empty strings when present', () => {
      for (const { path, definition } of definitions) {
        if (definition.toolNames === undefined) continue
        expect(Array.isArray(definition.toolNames), `${path}`).toBe(true)
        for (const tool of definition.toolNames) {
          expect(typeof tool, `${path}: tool name must be a string`).toBe('string')
          expect(tool.trim(), `${path}`).not.toBe('')
        }
      }
    })
  })

  describe('structured output', () => {
    it('outputMode structured_output requires an outputSchema of type object', () => {
      for (const { path, definition } of definitions) {
        if (definition.outputMode !== 'structured_output') continue
        expect(definition.outputSchema, `${path}: missing outputSchema`).toBeDefined()
        expect(definition.outputSchema?.type, `${path}`).toBe('object')
      }
    })

    it('outputSchema is only used with structured_output', () => {
      for (const { path, definition } of definitions) {
        if (definition.outputSchema === undefined) continue
        expect(definition.outputMode, `${path}`).toBe('structured_output')
      }
    })
  })

  describe('reasoningOptions', () => {
    it('provides max_tokens or effort when set', () => {
      for (const { path, definition } of definitions) {
        if (definition.reasoningOptions === undefined) continue
        const opts = definition.reasoningOptions
        const hasTokens = 'max_tokens' in opts && typeof opts.max_tokens === 'number'
        const hasEffort = 'effort' in opts && typeof opts.effort === 'string'
        expect(hasTokens || hasEffort, `${path}: provide max_tokens or effort`).toBe(true)
      }
    })
  })

  describe('spawnableAgents', () => {
    it('entries exist as local agents', () => {
      const ids = new Set(definitions.map(({ definition }) => definition.id))
      for (const { path, definition } of definitions) {
        for (const spawn of definition.spawnableAgents ?? []) {
          expect(
            ids.has(spawn),
            `${path}: spawnableAgents references '${spawn}' which is not a local agent`,
          ).toBe(true)
        }
      }
    })

    it('every spawned agent has a spawnerPrompt', () => {
      const byId = new Map(definitions.map(({ definition }) => [definition.id, definition]))
      const spawned = new Set(
        definitions.flatMap(({ definition }) => definition.spawnableAgents ?? []),
      )
      for (const id of spawned) {
        const target = byId.get(id)
        expect(
          target,
          `spawnableAgents references '${id}' which is not a local agent`,
        ).toBeDefined()
        expect(
          target!.spawnerPrompt?.trim(),
          `agent '${id}' is listed in another agent's spawnableAgents but has no spawnerPrompt`,
        ).not.toBe('')
      }
    })

    it('declared spawns are actually instructed in the agent prompts', () => {
      for (const { path, definition } of definitions) {
        if (!definition.spawnableAgents?.length) continue
        const prompts = [
          definition.instructionsPrompt,
          definition.systemPrompt,
          definition.stepPrompt,
          definition.spawnerPrompt,
        ]
          .filter((p): p is string => typeof p === 'string')
          .join('\n')
        for (const spawn of definition.spawnableAgents) {
          expect(
            prompts.includes(spawn),
            `${path}: declares spawnableAgent '${spawn}' but never mentions it in its prompts`,
          ).toBe(true)
        }
      }
    })
  })

  describe('project-planner spawn flow', () => {
    const planner = definitions.find(
      ({ definition }) => definition.id === 'project-planner',
    )?.definition

    it('declares requirements-writer and phase-planner as spawnable', () => {
      expect(planner, 'project-planner agent not found').toBeDefined()
      expect(planner!.spawnableAgents).toEqual(
        expect.arrayContaining(['requirements-writer', 'phase-planner']),
      )
    })

    it('instructs spawning requirements-writer for requirement-heavy goals', () => {
      const prompt = planner?.instructionsPrompt ?? ''
      expect(prompt).toContain('spawn the `requirements-writer` agent')
    })

    it('instructs spawning phase-planner per phase', () => {
      const prompt = planner?.instructionsPrompt ?? ''
      expect(prompt).toContain('spawn the `phase-planner` agent')
    })

    it('instructs invoking product-manager-pro when success metrics are unclear', () => {
      const prompt = planner?.instructionsPrompt ?? ''
      expect(prompt).toContain('`product-manager-pro`')
      expect(prompt).toContain('clear, measurable success metrics')
      expect(prompt).toContain("Carry the agreed metrics into the plan's outcome")
    })
  })
})

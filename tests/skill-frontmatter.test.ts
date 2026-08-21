/// <reference types="vite/client" />

import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from './skill-utils'

// Raw contents of every skill file in .agents/skills/<name>/SKILL.md.
const skillFiles = import.meta.glob('../.agents/skills/*/SKILL.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const skills = Object.entries(skillFiles).map(([path, raw]) => ({
  path,
  directory: path.split('/').at(-2),
  frontmatter: parseFrontmatter(raw),
}))

describe('skill frontmatter', () => {
  it('discovers at least one skill', () => {
    expect(skills.length).toBeGreaterThan(0)
  })

  it('has a frontmatter block delimited by ---', () => {
    for (const { path, frontmatter } of skills) {
      expect(Object.keys(frontmatter).length, `${path}: missing frontmatter`).toBeGreaterThan(0)
    }
  })

  describe('name', () => {
    it('is present and non-empty', () => {
      for (const { path, frontmatter } of skills) {
        expect(frontmatter.name?.trim(), `${path}: missing name`).not.toBe('')
      }
    })

    it('matches ^[a-z0-9-]+$ (lowercase letters, numbers, hyphens)', () => {
      for (const { path, frontmatter } of skills) {
        expect(frontmatter.name, `${path}: invalid name`).toMatch(/^[a-z0-9-]+$/)
      }
    })

    it('matches its directory name', () => {
      for (const { path, directory, frontmatter } of skills) {
        expect(directory, `${path}: cannot determine directory`).toBeDefined()
        expect(frontmatter.name, `${path}: name must match directory`).toBe(directory)
      }
    })

    it('is unique across skills', () => {
      const names = skills.map(({ frontmatter }) => frontmatter.name)
      expect(new Set(names).size).toBe(names.length)
    })
  })

  describe('description', () => {
    it('is present and non-empty', () => {
      for (const { path, frontmatter } of skills) {
        expect(frontmatter.description?.trim(), `${path}: missing description`).not.toBe('')
      }
    })

    it('describes when to use the skill (not just what it is)', () => {
      for (const { path, frontmatter } of skills) {
        const description = frontmatter.description ?? ''
        expect(
          /\b(when|use|for|turns?|turn|write|break|plan|create|design|architect)\b/i.test(
            description,
          ),
          `${path}: description should be action-oriented`,
        ).toBe(true)
      }
    })
  })

  describe('version', () => {
    it('is present and matches semver (X.Y.Z)', () => {
      for (const { path, frontmatter } of skills) {
        expect(frontmatter.version, `${path}: missing version`).toMatch(/^\d+\.\d+\.\d+$/)
      }
    })
  })

  describe('invocation', () => {
    it('invoked_by is present and one of user | agent | both', () => {
      for (const { path, frontmatter } of skills) {
        expect(['user', 'agent', 'both'], `${path}: invalid invoked_by`).toContain(
          frontmatter.invoked_by,
        )
      }
    })

    it('user_invocable is present and a boolean', () => {
      for (const { path, frontmatter } of skills) {
        expect(frontmatter.user_invocable, `${path}: missing user_invocable`).toMatch(
          /^(true|false)$/,
        )
      }
    })
  })

  describe('source', () => {
    it('is present and one of builtin | user-custom-rule', () => {
      for (const { path, frontmatter } of skills) {
        expect(['builtin', 'user-custom-rule'], `${path}: invalid source`).toContain(
          frontmatter.source,
        )
      }
    })
  })
})

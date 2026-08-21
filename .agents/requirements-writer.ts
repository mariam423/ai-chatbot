/**
 * Requirements Writer Agent
 *
 * Elicits, analyzes, and writes clear, testable functional and non-functional
 * requirements with acceptance criteria. Embodies the requirements-engineer
 * skill workflow and returns requirements as structured output, so it can be
 * spawned by planners and other agents for requirement-writing tasks.
 */

import { AgentDefinition, ModelName } from './types/agent-definition'

const definition: AgentDefinition = {
  id: 'requirements-writer',
  version: '0.0.1',
  displayName: 'Requirements Writer',
  model: 'anthropic/claude-sonnet-4.5' satisfies ModelName,

  reasoningOptions: {
    effort: 'high',
  },

  // Read-only: explores context and produces requirements; it never edits
  // files. The caller decides how to persist the result.
  toolNames: [
    'read_files',
    'read_subtree',
    'code_search',
    'glob',
    'list_directory',
    'find_files',
    'ask_user',
    'set_output',
  ],

  inputSchema: {
    prompt: {
      type: 'string',
      description:
        'Describe the feature or task to write requirements for, plus any constraints, users, or context',
    },
  },

  outputMode: 'structured_output',
  outputSchema: {
    type: 'object',
    description: 'The structured requirements document',
    properties: {
      summary: {
        type: 'string',
        description: 'Overview of the requirement set and its scope',
      },
      requirements: {
        type: 'array',
        description: 'Atomic, testable requirements',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable id, e.g. REQ-1' },
            category: {
              type: 'string',
              enum: ['functional', 'non-functional', 'constraint'],
              description:
                'functional = what the system does, non-functional = performance/security/availability, constraint = external limitation',
            },
            statement: {
              type: 'string',
              description: 'Single atomic requirement using MUST / SHOULD / MAY',
            },
            acceptanceCriteria: {
              type: 'array',
              description: 'Verifiable Given/When/Then criteria',
              items: { type: 'string' },
            },
            source: {
              type: 'string',
              description: 'Origin need or story this requirement traces to',
            },
          },
          required: ['id', 'statement', 'acceptanceCriteria'],
        },
      },
      openQuestions: {
        type: 'array',
        description: 'Ambiguities or decisions still needed',
        items: { type: 'string' },
      },
    },
    required: ['summary', 'requirements'],
  },

  spawnerPrompt:
    'Use when you need clear, testable functional and non-functional requirements with acceptance criteria for a feature or task. Spawn with a description of what the feature does and any constraints.',

  systemPrompt:
    'You are a requirements engineer. You turn ambiguous input into atomic, testable requirements — you never edit files.',

  instructionsPrompt: `You are a requirements engineer. Follow this process:

1. Elicit, don't assume: use read_files / code_search / glob / list_directory to understand the existing system and context first. Ask the user via ask_user about anything genuinely ambiguous (users, edge cases, failure modes, constraints) before writing requirements.
2. Write each requirement as a single atomic statement. Split compound requirements ("must do X and Y") into separate items.
3. Separate functional requirements (what the system does) from non-functional ones (performance, security, availability, usability) and give non-functional ones explicit, measurable targets.
4. Give every requirement verifiable acceptance criteria in Given/When/Then form. If a requirement cannot be verified, rework it.
5. Cover the edges explicitly: empty input, boundary values, errors, concurrency, unauthorized access.
6. Use MUST / SHOULD / MAY consistently and never use "etc." or "and/or". Number requirements (REQ-1, REQ-2, ...) and set the source field to the origin need for traceability.
7. Flag conflicting or missing requirements immediately rather than papering over them; list genuine ambiguities under openQuestions.

Return the requirements using the structured output schema: a summary, the requirement list (id, category, statement, acceptance criteria, source), and open questions.`,
}

export default definition

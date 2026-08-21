/**
 * Codebase Overview Agent
 *
 * Maps the repository: components and their responsibilities, dependencies,
 * data flow, and conventions. Applies the architecture-designer skill in
 * documentation mode — it describes the architecture as it exists, not as
 * it should be.
 */

import { AgentDefinition, ModelName } from './types/agent-definition'

const definition: AgentDefinition = {
  id: 'codebase-overview',
  version: '0.0.1',
  displayName: 'Codebase Overview',
  model: 'anthropic/claude-sonnet-4.5' satisfies ModelName,

  reasoningOptions: {
    effort: 'high',
  },

  // Read-only: explores the repo and returns an architecture map. It never
  // edits files and does not need to ask the user.
  toolNames: [
    'skill',
    'read_files',
    'read_subtree',
    'code_search',
    'glob',
    'list_directory',
    'find_files',
    'set_output',
  ],

  inputSchema: {
    prompt: {
      type: 'string',
      description:
        'The area of the repo to map (leave general for a whole-repo overview), plus any focus areas or questions',
    },
  },

  outputMode: 'structured_output',
  outputSchema: {
    type: 'object',
    description: 'The structured codebase architecture map',
    properties: {
      overview: {
        type: 'string',
        description: 'High-level summary of the codebase and its architecture',
      },
      components: {
        type: 'array',
        description: 'The main components/modules and their boundaries',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Component or module name' },
            responsibility: { type: 'string', description: 'What it owns and must not do' },
            location: {
              type: 'string',
              description: 'Key files or directories',
            },
            contract: {
              type: 'string',
              description: 'Public surface: entry points, exports, APIs',
            },
            dependsOn: {
              type: 'array',
              description: 'Components it depends on',
              items: { type: 'string' },
            },
          },
          required: ['name', 'responsibility', 'location'],
        },
      },
      dataFlow: {
        type: 'array',
        description: 'How data moves through the system: producers, consumers, connections',
        items: { type: 'string' },
      },
      conventions: {
        type: 'array',
        description: 'Notable patterns, constraints, and gotchas observed in the code',
        items: { type: 'string' },
      },
      openQuestions: {
        type: 'array',
        description: 'Gaps or relationships that could not be verified',
        items: { type: 'string' },
      },
    },
    required: ['overview', 'components'],
  },

  spawnerPrompt:
    'Use when you need an accurate map of the codebase — components, responsibilities, dependencies, data flow, conventions — before planning, reviewing, or modifying code. Spawn with the area to map or leave general.',

  systemPrompt:
    'You are a codebase mapper. You produce accurate architecture overviews grounded in the actual code — you never edit files.',

  instructionsPrompt: `You are a codebase mapper producing an architecture overview of the repository. Follow this process:

1. Load the \`architecture-designer\` skill via the skill tool and apply its boundary and data-flow discipline in documentation mode: describe the architecture as it exists, not as it should be.
2. Explore systematically: start from entry points and config (package.json, tsconfig, config files, main modules) with read_files / read_subtree, then use code_search / glob / list_directory to locate components and their boundaries. Trace imports, callers, and exports to confirm relationships — never guess a dependency you could verify by reading the code.
3. For each component, capture: name, responsibility (what it owns and must not do), location, public contract (entry points, exports, APIs), and what it depends on.
4. Make data flow explicit: who produces, who consumes, and how they connect. Note where data crosses component boundaries.
5. Record conventions, constraints, and gotchas you actually observe (naming, patterns, tech choices, dead code, surprises).
6. Be honest about uncertainty: mark unverified relationships as unverified and put genuine gaps under openQuestions.

Return the map using the structured output schema: overview, components (name, responsibility, location, contract, dependsOn), data flow, conventions, and open questions.`,
}

export default definition

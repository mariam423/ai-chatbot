/**
 * Phase Planner Agent
 *
 * Produces the detailed, executable plan for a single phase of a larger
 * project: tasks with done-criteria, intra-phase dependencies, range
 * estimates, and phase-level risks. Spawned by the project-planner agent,
 * one instance per phase.
 */

import { AgentDefinition, ModelName } from './types/agent-definition'

const definition: AgentDefinition = {
  id: 'phase-planner',
  version: '0.0.1',
  displayName: 'Phase Planner',
  model: 'anthropic/claude-sonnet-4.5' satisfies ModelName,

  reasoningOptions: {
    effort: 'high',
  },

  // Read-only: explores the repo and returns a detailed phase plan. It does
  // not ask the user (the parent planner owns user interaction) and never
  // edits files.
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
        'The phase to plan: its name, goal, scope, constraints, and dependencies on other phases',
    },
  },

  outputMode: 'structured_output',
  outputSchema: {
    type: 'object',
    description: 'The detailed plan for a single phase',
    properties: {
      phase: { type: 'string', description: 'Phase name' },
      goal: {
        type: 'string',
        description: 'What this phase delivers and how it is verified',
      },
      tasks: {
        type: 'array',
        description: 'Tasks within this phase',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Stable task id within the phase, e.g. T1' },
            description: { type: 'string' },
            dependsOn: {
              type: 'array',
              description: 'Task ids that must finish first',
              items: { type: 'string' },
            },
            estimate: {
              type: 'string',
              description: 'Range with confidence, e.g. "2-4h, medium"',
            },
            doneCriteria: { type: 'string' },
          },
          required: ['id', 'description'],
        },
      },
      risks: {
        type: 'array',
        description: 'Phase-level risks with mitigations',
        items: {
          type: 'object',
          properties: {
            risk: { type: 'string' },
            likelihood: { type: 'string', enum: ['low', 'medium', 'high'] },
            impact: { type: 'string', enum: ['low', 'medium', 'high'] },
            mitigation: { type: 'string' },
          },
          required: ['risk', 'mitigation'],
        },
      },
      openQuestions: {
        type: 'array',
        description: 'Ambiguities or blockers found while planning this phase',
        items: { type: 'string' },
      },
    },
    required: ['phase', 'goal', 'tasks'],
  },

  spawnerPrompt:
    "Use when you need a detailed, executable plan for a single phase of a larger project plan. Spawn with the phase's goal, scope, constraints, and dependencies on other phases.",

  systemPrompt:
    'You are a phase planner. You produce detailed, executable plans for a single phase of a larger project — you never edit files and never ask the user directly.',

  instructionsPrompt: `You are a phase planner producing the detailed plan for ONE phase of a larger project. Follow this process:

1. Load the \`planner-pro-max\` skill via the skill tool and follow its task-decomposition guidance, scoped to this single phase: state what the phase delivers and how it is verified, decompose into small tasks (hours to a couple of days) each with done-criteria, map dependencies within the phase, estimate with ranges and confidence, and list phase-level risks with mitigations.
2. Ground in the repo: use read_files / code_search / glob / list_directory to inspect the actual code, conventions, and constraints before estimating. Never estimate against assumptions you could verify by reading the code.
3. Treat the phase goal and scope you were given as final. If something is genuinely blocking or contradictory, record it under openQuestions rather than asking the user.
4. Return the phase plan via the structured output schema: phase name, goal, tasks (id, description, dependsOn, estimate, doneCriteria), risks with mitigations, and open questions.

Be specific and decisive: task ids stable within the phase (T1, T2, ...), estimates as ranges, and every task small enough to finish in a day or two.`,
}

export default definition

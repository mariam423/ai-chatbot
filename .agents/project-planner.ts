/**
 * Project Planner Agent
 *
 * Turns a goal into a concrete, executable plan by loading and following the
 * planner-pro-max skill workflow (phases, tasks, dependencies, estimates,
 * risks), pulling in product-manager-pro when the goal lacks clear metrics,
 * requirements-writer when requirements are unclear, and
 * architecture-designer for architecture-heavy goals. Returns the plan as
 * structured output.
 */

import { AgentDefinition, ModelName } from './types/agent-definition'

const definition: AgentDefinition = {
  id: 'project-planner',
  version: '0.0.1',
  displayName: 'Project Planner',
  model: 'anthropic/claude-sonnet-4.5' satisfies ModelName,

  reasoningOptions: {
    effort: 'high',
  },

  // Can spawn sub-agents for subtasks (local agent ids, no
  // publisher/version needed): requirements-writer for requirement
  // writing, phase-planner for per-phase detail.
  spawnableAgents: ['requirements-writer', 'phase-planner'],

  // Read-only planning: loads skills, explores the repo, asks clarifying
  // questions, spawns sub-agents for phase-level detail, and outputs a
  // plan — it never edits files.
  toolNames: [
    'skill',
    'spawn_agents',
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
        'Describe the goal or outcome to plan for, plus any constraints, deadlines, or known unknowns',
    },
  },

  outputMode: 'structured_output',
  outputSchema: {
    type: 'object',
    description: 'The structured project plan',
    properties: {
      outcome: {
        type: 'string',
        description: 'The measurable outcome this plan delivers',
      },
      phases: {
        type: 'array',
        description: 'Plan phases, each delivering something usable',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Phase name' },
            goal: {
              type: 'string',
              description: 'What this phase delivers and how it is verified',
            },
            tasks: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Stable task id, e.g. T1' },
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
          },
          required: ['name', 'tasks'],
        },
      },
      risks: {
        type: 'array',
        description: 'Top risks with mitigations',
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
        description: 'Decisions or inputs still needed',
        items: { type: 'string' },
      },
    },
    required: ['outcome', 'phases', 'risks'],
  },

  spawnerPrompt:
    'Use when you need a concrete, actionable project plan — phases, tasks, dependencies, estimates, and risks — for a goal. Spawn with a description of the goal and any constraints.',

  systemPrompt:
    'You are a senior project planner. You turn goals into executable, trackable plans grounded in the actual repository — you never edit files.',

  instructionsPrompt: `You are a senior project planner. Follow this process:

1. Load the \`planner-pro-max\` skill via the skill tool and follow its workflow: define the measurable outcome and phase the work into usable milestones at a high level (phase name, goal, rough scope). Then spawn the \`phase-planner\` agent via spawn_agents — one per phase, in parallel — passing each phase's goal, scope, constraints, and dependencies; fold the returned per-phase plans (tasks, estimates, risks) into the overall plan. Plan trivial phases yourself instead of spawning.
2. If the goal is architecture-heavy — a new system or component, significant restructuring, or hard performance/scale/security constraints — load the \`architecture-designer\` skill via the skill tool and apply its boundary and data-flow discipline when defining phases: ground phase boundaries, dependencies, and sequencing in architectural considerations, and carry its open questions forward.
3. If the goal lacks clear, measurable success metrics — or the problem statement or scope is fuzzy — load the \`product-manager-pro\` skill via the skill tool and use its workflow to pin down the problem statement, 1-3 measurable success metrics, and a prioritized scope before planning. Carry the agreed metrics into the plan's outcome field and use them as the done-criteria for the phases that deliver them.
4. Elicit requirements: if the goal involves features or behaviors whose requirements are not already clear and testable, spawn the \`requirements-writer\` agent via spawn_agents — pass it the goal, known constraints, target users, and decisions already made — and incorporate its structured requirements into the plan (its acceptance criteria become the done-criteria for the related tasks). Use the loaded \`requirements-engineer\` skill only for quick clarifications; default to spawning the agent for anything non-trivial.
5. Ground the plan in reality: use read_files / code_search / glob / list_directory to inspect the repository (existing code, conventions, constraints) before estimating. Never plan against assumptions you could verify by reading the code.
6. Ask the user via ask_user for anything genuinely blocking (scope decisions, priorities, unknowns you cannot resolve) — then proceed with the best reasonable assumption, flagged as an open question.
7. Return the plan using the structured output schema: outcome, phases (with tasks, dependencies, estimates, done-criteria), risks with mitigations, and open questions.

Be decisive and specific — estimates as ranges, tasks small enough to finish in hours to a couple of days, and every phase delivering something reviewable.`,
}

export default definition

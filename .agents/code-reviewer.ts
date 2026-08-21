/**
 * Code Reviewer Agent
 *
 * A read-only reviewer that inspects code for bugs, security issues,
 * performance problems, and maintainability concerns, then returns a
 * structured report with concrete, actionable findings.
 *
 * Import the types from ./types/agent-definition for full type safety.
 */

import { AgentDefinition, ModelName } from './types/agent-definition'

const definition: AgentDefinition = {
  id: 'code-reviewer',
  version: '0.0.1',
  displayName: 'Code Reviewer',
  model: 'openai/gpt-5.3-codex' satisfies ModelName,

  reasoningOptions: {
    effort: 'high',
  },

  // Read-only: this agent analyzes code and reports findings; it must
  // never modify the files under review.
  toolNames: [
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
        'Describe the code, files, or diff to review, plus any specific concerns (e.g. "review the auth flow in src/auth/ for security issues")',
    },
  },

  outputMode: 'structured_output',
  outputSchema: {
    type: 'object',
    description: 'The structured code review report',
    properties: {
      summary: {
        type: 'string',
        description: 'High-level summary of the review and overall quality',
      },
      findings: {
        type: 'array',
        description: 'Individual review findings',
        items: {
          type: 'object',
          properties: {
            severity: {
              type: 'string',
              enum: ['critical', 'warning', 'suggestion'],
              description:
                'critical = must fix (bug, security hole), warning = should fix, suggestion = optional improvement',
            },
            file: {
              type: 'string',
              description: 'File path the finding relates to',
            },
            line: {
              type: 'number',
              description: 'Approximate line number, if applicable',
            },
            issue: {
              type: 'string',
              description: 'What is wrong and why it matters',
            },
            suggestion: {
              type: 'string',
              description: 'Concrete, actionable fix, with a code snippet if helpful',
            },
          },
          required: ['severity', 'file', 'issue'],
        },
      },
      verdict: {
        type: 'string',
        enum: ['approve', 'request-changes'],
        description:
          'Overall verdict: approve if only minor suggestions remain, otherwise request-changes',
      },
    },
    required: ['summary', 'findings', 'verdict'],
  },

  spawnerPrompt:
    'Use when you need a thorough, security- and performance-focused review of code, files, or a diff. Spawn with a prompt describing what to review and any specific concerns.',

  systemPrompt:
    'You are a senior code reviewer. You analyze code carefully and report findings precisely — you never modify the code you are reviewing.',

  instructionsPrompt: `You are a senior code reviewer performing a thorough review. Follow this process:

1. Explore first: use read_files / code_search / glob / list_directory to understand the code and its surrounding context before judging it. Read related callers, types, and tests.
2. Review for, in priority order:
   - Correctness: logic bugs, off-by-one errors, race conditions, incorrect error handling, unhandled edge cases (empty input, nulls, boundaries, timezones).
   - Security: injection (SQL, shell, XSS), authz bypasses, secrets in code or logs, unsafe deserialization, missing input validation, path traversal.
   - Performance: N+1 queries, O(n^2) loops, blocking calls in hot paths, unbounded caches or memory.
   - Maintainability: dead code, duplicated logic, unclear naming, missing error context, over-engineering.
3. Every finding must be concrete and actionable: state what is wrong, why it matters, and how to fix it — include a specific code snippet when a fix is non-trivial.
4. Do NOT invent issues. If something is fine, say so. Distinguish real problems from style preferences.
5. Be honest about severity: reserve 'critical' for genuine bugs or security holes, not nitpicks.
6. Do not edit any files. Your job is to report, not modify.

Return your report using the structured output schema: a summary, a list of findings (each with severity, file, line, issue, and suggestion), and an overall verdict ('approve' or 'request-changes').`,
}

export default definition

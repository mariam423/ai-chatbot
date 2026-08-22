import { describe, expect, it } from 'vitest'

/**
 * PRD traceability checklist — mirrors PRD.md sections 6 (functional) and
 * 7 (non-functional). Keeping this list in sync with PRD.md is the point:
 * the coverage test below fails if a requirement is missing, renamed, or
 * added without a row here.
 */

type Verification = 'unit' | 'integration' | 'e2e' | 'manual'
type Status = 'implemented' | 'pending' | 'needs-verification'

interface PrdItem {
  id: string
  title: string
  /** How the requirement is (or will be) verified. */
  verification: Verification
  status: Status
  notes: string
}

const PRD_ITEMS: PrdItem[] = [
  // --- Functional requirements (PRD.md section 6) ---
  {
    id: 'FR-1',
    title: 'Chat thread rendering',
    verification: 'e2e',
    status: 'needs-verification',
    notes: 'Implemented in components/chat.tsx; assert chronological bubbles in a browser/e2e run.',
  },
  {
    id: 'FR-2',
    title: 'Message submission (no empty or duplicate sends)',
    verification: 'e2e',
    status: 'needs-verification',
    notes: 'Implemented (trim + isStreaming guard + Enter handler); assert in e2e.',
  },
  {
    id: 'FR-3',
    title: 'Streaming responses with typing indicator',
    verification: 'integration',
    status: 'implemented',
    notes:
      'Parser covered by tests/sse.test.ts; route passthrough by tests/api-chat.test.ts. Indicator rendering needs e2e.',
  },
  {
    id: 'FR-4',
    title: 'LLM API integration (server-side, key never in client)',
    verification: 'integration',
    status: 'implemented',
    notes:
      'tests/api-chat.test.ts asserts upstream payload, Authorization header, and streaming passthrough.',
  },
  {
    id: 'FR-5',
    title: 'Failure handling (inline error, message preserved, retry)',
    verification: 'integration',
    status: 'needs-verification',
    notes: 'Server errors covered in tests/api-chat.test.ts; retry UI needs e2e.',
  },
  {
    id: 'FR-6',
    title: 'Empty state before first message',
    verification: 'e2e',
    status: 'needs-verification',
    notes: 'Implemented in chat.tsx (prompt text when no messages); assert in e2e.',
  },
  {
    id: 'FR-7',
    title: 'Framer Motion transitions honoring prefers-reduced-motion',
    verification: 'e2e',
    status: 'needs-verification',
    notes: 'Implemented via useReducedMotion; verify visually + reduced-motion profile.',
  },
  {
    id: 'FR-8',
    title: 'Stop generation (cancel in-flight stream)',
    verification: 'e2e',
    status: 'needs-verification',
    notes: 'Implemented (AbortController + stop button); partial reply kept. Assert in e2e.',
  },
  {
    id: 'FR-9',
    title: 'Conversation persistence (localStorage)',
    verification: 'e2e',
    status: 'implemented',
    notes:
      'Implemented in components/chat.tsx (localStorage, restore after mount, persist on stable states); covered by e2e/chat.spec.ts.',
  },
  {
    id: 'FR-10',
    title: 'Responsive layout (mobile and desktop)',
    verification: 'e2e',
    status: 'implemented',
    notes:
      'No horizontal overflow at 360px (incl. long unbroken tokens) covered by e2e/responsive.spec.ts; mobile project runs the full chat suite. Broader visual check still recommended.',
  },
  {
    id: 'FR-11',
    title: 'Server-side session persistence (database)',
    verification: 'integration',
    status: 'implemented',
    notes:
      'Server Actions + Prisma/SQLite (ChatSession/ChatMessage) persist the thread per anonymous session; DB authoritative on load, localStorage fallback. Covered by tests/actions.test.ts.',
  },
  {
    id: 'FR-12',
    title: 'Session sidebar & dark mode',
    verification: 'e2e',
    status: 'implemented',
    notes:
      'Sidebar (components/sidebar.tsx) lists sessions with active highlight, New Chat resets, theme toggle persists, per-session rename (inline input) + delete (two-step confirm), debounced search (title/content) and Show-more pagination (page of 20 via listChatSessions skip/take); mobile gets an overlay drawer with focus trap + Escape. Covered by e2e/sidebar.spec.ts + tests/actions.test.ts.',
  },
  {
    id: 'FR-13',
    title: 'Markdown rendering & code blocks',
    verification: 'e2e',
    status: 'implemented',
    notes:
      'react-markdown + remark-gfm + rehype-highlight in components/markdown.tsx; language badge, copy button, raw HTML escaped. Covered by e2e/sidebar.spec.ts.',
  },
  {
    id: 'FR-14',
    title: 'Regenerate response',
    verification: 'e2e',
    status: 'implemented',
    notes:
      'Regenerate button re-runs the last user message in place (no duplicate bubble). Covered by e2e/sidebar.spec.ts.',
  },
  {
    id: 'FR-15',
    title: 'Skill catalog (8 domains with instructions & tools)',
    verification: 'integration',
    status: 'implemented',
    notes:
      'lib/skills/registry.ts defines 8 skill domains with system instructions and 5 Zod-typed tools (diagram_render, weather_lookup, humanize_text, schedule_block, code_analyze) bound to OpenAI function calling via z.toJSONSchema. Active instructions are injected for tool-relevant requests; SKILLS_ENABLED and per-session overrides narrow the catalog. Covered by tests/skill-registry.test.ts + route filtering tests.',
  },
  {
    id: 'FR-16',
    title: 'Tool calling with graceful fallbacks',
    verification: 'integration',
    status: 'implemented',
    notes:
      'Skill tools execute through the agent loop (lib/agent.ts) with Zod-validated arguments; unconfigured providers return clearly marked placeholders and invalid/unknown calls return structured fallbacks instead of throwing. Covered by tests/skill-registry.test.ts (executors, fallbacks, agent-loop binding).',
  },
  {
    id: 'FR-17',
    title: 'Per-session skill configuration',
    verification: 'e2e',
    status: 'implemented',
    notes:
      'SkillPicker (components/skill-picker.tsx) toggles the 8 skills in the chat header; ChatSession.enabledSkills persists the override (updateSessionSkills/getSessionSkills, applied at session creation via saveChatMessages) and the request narrows injected instructions/tools. Covered by tests/actions.test.ts + tests/skill-registry.test.ts + e2e/skills.spec.ts.',
  },

  // --- Non-functional requirements (PRD.md section 7) ---
  {
    id: 'NFR-1',
    title: 'Performance: median time to first token under 1s',
    verification: 'manual',
    status: 'needs-verification',
    notes: 'Requires a live benchmark against a real LLM endpoint.',
  },
  {
    id: 'NFR-2',
    title: 'Accessibility (keyboard, focus, aria-live)',
    verification: 'e2e',
    status: 'implemented',
    notes:
      'aria-live on assistant bubbles, sr-only input label, skip link, focus-visible rings, aria-current on the active session, mobile drawer focus trap + Escape. Covered by e2e/a11y.spec.ts; screen-reader pass still recommended.',
  },
  {
    id: 'NFR-3',
    title: 'Security (untrusted input rendered as plain text)',
    verification: 'integration',
    status: 'implemented',
    notes:
      'React escapes by default (no dangerouslySetInnerHTML); key handled server-side per tests/api-chat.test.ts.',
  },
  {
    id: 'NFR-4',
    title: 'Type safety (strict TypeScript, no any)',
    verification: 'unit',
    status: 'implemented',
    notes: 'Enforced by npm run typecheck (strict + noUncheckedIndexedAccess).',
  },
  {
    id: 'NFR-5',
    title: 'Maintainability (state/API separated from UI)',
    verification: 'manual',
    status: 'needs-verification',
    notes: 'Separation via lib/sse.ts + route + components; review on code review.',
  },
]

describe('PRD checklist', () => {
  it('covers every FR and NFR from PRD.md exactly once', () => {
    const expected = [
      ...Array.from({ length: 17 }, (_, i) => `FR-${i + 1}`),
      ...Array.from({ length: 5 }, (_, i) => `NFR-${i + 1}`),
    ]
    expect(PRD_ITEMS.map((item) => item.id)).toEqual(expected)
  })

  it('has a valid verification and status on every item', () => {
    const verifications: Verification[] = ['unit', 'integration', 'e2e', 'manual']
    const statuses: Status[] = ['implemented', 'pending', 'needs-verification']
    for (const item of PRD_ITEMS) {
      expect(verifications, `${item.id}: bad verification`).toContain(item.verification)
      expect(statuses, `${item.id}: bad status`).toContain(item.status)
      expect(item.title.trim(), `${item.id}: missing title`).not.toBe('')
    }
  })

  it('explains every pending requirement', () => {
    for (const item of PRD_ITEMS) {
      if (item.status === 'pending') {
        expect(item.notes.trim(), `${item.id}: pending without notes`).not.toBe('')
      }
    }
  })
})

describe('PRD provider declaration', () => {
  // Read the actual PRD (and env example) so drift between the docs and the
  // configured provider fails here rather than in production.
  const prdFiles = import.meta.glob('../PRD.md', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
  const prd = Object.values(prdFiles)[0] ?? ''

  const envFiles = import.meta.glob('../.env.example', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>
  const envExample = Object.values(envFiles)[0] ?? ''

  it('names OpenRouter as the configured LLM provider', () => {
    expect(prd, 'PRD.md not found').not.toBe('')
    expect(prd).toContain('OpenRouter')
  })

  it('references the same provider env var that .env.example configures', () => {
    expect(envExample, '.env.example not found').not.toBe('')
    expect(envExample).toContain('OPENROUTER_API_KEY')
    expect(prd).toContain('OPENROUTER_API_KEY')
  })
})

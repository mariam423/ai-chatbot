import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getCurrentUserId } from '@/lib/auth-context'

export const MemoryCategorySchema = z.enum(['preference', 'entity', 'summary'])
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>

const MemoryInputSchema = z.object({
  category: MemoryCategorySchema,
  key: z.string().trim().min(1).max(100),
  value: z.string().trim().min(1).max(1_000),
  confidence: z.number().min(0).max(1).default(1),
  sessionId: z.string().trim().min(1).max(100).optional(),
})

export type MemoryInput = z.input<typeof MemoryInputSchema>
export interface MemoryRecord {
  id: string
  category: MemoryCategory
  key: string
  value: string
  confidence: number
  updatedAt: string
}

const MAX_MEMORY_RECORDS = 30
const MAX_MEMORY_CONTEXT = 4_000

/** Extract deterministic, explicit memories without a second LLM call. */
export function extractMemoryCandidates(text: string): MemoryInput[] {
  const candidates: MemoryInput[] = []
  const preference = text.match(/\b(?:i prefer|my preference is)\s+([^.!?]{1,120})/i)
  if (preference?.[1]) {
    candidates.push({
      category: 'preference',
      key: 'explicit-preference',
      value: preference[1].trim(),
    })
  }
  const name = text.match(/\b(?:my name is|call me)\s+([A-Za-z][A-Za-z '-]{1,80})/i)
  if (name?.[1]) candidates.push({ category: 'entity', key: 'user-name', value: name[1].trim() })
  return candidates
}

async function currentUserId(): Promise<string | null> {
  const userId = await getCurrentUserId()
  return process.env.AUTH_DISABLED === 'true' ? null : userId
}

/** Upsert one memory record for the authenticated user. */
export async function saveMemory(
  input: MemoryInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = MemoryInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid memory record.' }
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: 'Not authenticated.' }
  try {
    await prisma.memoryRecord.upsert({
      where: {
        userId_category_key: { userId, category: parsed.data.category, key: parsed.data.key },
      },
      create: { userId, ...parsed.data },
      update: {
        value: parsed.data.value,
        confidence: parsed.data.confidence,
        sessionId: parsed.data.sessionId,
      },
    })
    return { ok: true }
  } catch {
    return { ok: false, error: 'Could not save memory.' }
  }
}

/** Save explicit memories found in a user message; failures are best-effort. */
export async function rememberFromMessage(text: string, sessionId?: string): Promise<void> {
  const candidates = extractMemoryCandidates(text).map((candidate) => ({ ...candidate, sessionId }))
  await Promise.all(candidates.map((candidate) => saveMemory(candidate)))
}

/**
 * Persist a bounded, deterministic summary of a conversation. This avoids a
 * second model call while still retaining useful cross-session continuity.
 */
export async function rememberConversationSummary(
  messages: Array<{ role: string; content: string }>,
  sessionId?: string,
): Promise<void> {
  if (messages.length < 2) return
  const summary = messages
    .slice(-4)
    .map(({ role, content }) => `${role}: ${content.replace(/\\s+/g, ' ').trim()}`)
    .join(' | ')
    .slice(0, 1_000)
  if (!summary) return
  await saveMemory({
    category: 'summary',
    key: sessionId ? `session-${sessionId}` : 'recent-conversation',
    value: summary,
    sessionId,
  })
}

/** Retrieve recent memory for the authenticated user. */
export async function getUserMemory(): Promise<MemoryRecord[]> {
  const userId = await currentUserId()
  if (!userId) return []
  try {
    const rows = await prisma.memoryRecord.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: MAX_MEMORY_RECORDS * 3,
    })
    const categoryCounts = new Map<MemoryCategory, number>()
    const cappedRows = rows
      .filter((row) => {
        const category = MemoryCategorySchema.safeParse(row.category)
        if (!category.success) return false
        const count = categoryCounts.get(category.data) ?? 0
        if (count >= MAX_MEMORY_RECORDS / 3) return false
        categoryCounts.set(category.data, count + 1)
        return true
      })
      .slice(0, MAX_MEMORY_RECORDS)
    return cappedRows.map((row) => ({
      id: row.id,
      category: MemoryCategorySchema.parse(row.category),
      key: row.key,
      value: row.value,
      confidence: row.confidence,
      updatedAt: row.updatedAt.toISOString(),
    }))
  } catch {
    return []
  }
}

/** Format memories as bounded, clearly separated prompt context. */
export function formatMemoryContext(records: MemoryRecord[]): string {
  let used = 0
  const lines: string[] = []
  for (const record of records) {
    const line = `- [${record.category}] ${record.key}: ${record.value}`
    if (used + line.length > MAX_MEMORY_CONTEXT) break
    lines.push(line)
    used += line.length
  }
  return lines.join('\n')
}

export async function getUserMemoryContext(): Promise<string> {
  return formatMemoryContext(await getUserMemory())
}

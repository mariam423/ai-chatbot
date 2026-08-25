import type { ChatMessage } from './types'

/**
 * Pure chat-export helpers (Markdown / JSON) — kept free of DOM so they are
 * unit-testable in Node. PDF export lives in the client (components/chat-export)
 * via the browser's native Print → Save-as-PDF.
 */

/** Default export page title when the conversation has no derived title. */
export const EXPORT_DEFAULT_TITLE = 'Chat transcript'

/** Sanitize a title into a safe file basename (no path separators, trimmed). */
export function exportFileName(title: string | undefined, ext: string): string {
  const base = (title ?? EXPORT_DEFAULT_TITLE)
    .replace(/[^a-z0-9-_ ]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  const safe = base || 'chat'
  return `${safe}.${ext}`
}

const roleLabel: Record<ChatMessage['role'], string> = {
  user: 'You',
  assistant: 'Assistant',
}

function escapeMarkdown(text: string): string {
  return text.replace(/^#{1,6}\s+/gm, '\\# ').replace(/^\s*([-*+])\s+/gm, '\\$1 ')
}

/**
 * Render a linear thread as a readable Markdown transcript with `## Role`
 * section headers. Leading paragraphs render as plain text under the heading.
 */
export function chatToMarkdown(messages: ChatMessage[], title?: string): string {
  const lines: string[] = []
  lines.push(`# ${title ?? EXPORT_DEFAULT_TITLE}`)
  lines.push('')
  for (const message of messages) {
    const label = roleLabel[message.role] ?? message.role
    lines.push(`## ${label}`)
    // Assistant replies carry which model served them (stamped from the
    // route's X-Served-Model header) — surface it as a small line under the
    // heading so shared transcripts keep the provenance. `fallback` tags the
    // amber-warning case where the served model differed from the selection.
    if (message.role === 'assistant' && message.model) {
      const tag = message.modelOverridden ? ' (fallback)' : ''
      lines.push('')
      lines.push(`*via ${message.model}${tag}*`)
    }
    lines.push('')
    const body = escapeMarkdown(message.content)
    // Indent multi-paragraph content so it stays under the heading, and blank a
    // separate line so consecutive code blocks don't merge.
    const paragraphs = body.split(/\n{2,}/)
    if (paragraphs.length > 1) {
      for (const paragraph of paragraphs) {
        lines.push(
          paragraph
            .trim()
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n'),
        )
        lines.push('')
      }
    } else {
      lines.push(body)
      lines.push('')
    }
  }
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  )
}

/**
 * Serialize a linear thread as a JSON export. `title` and `exportedAt` are
 * included as metadata; messages carry role + content (stable, no client ids).
 */
export function chatToJson(messages: ChatMessage[], title?: string): string {
  const payload = {
    title: title ?? EXPORT_DEFAULT_TITLE,
    exportedAt: new Date().toISOString(),
    // `model`/`modelOverridden` ride along only when the message carries them
    // (assistant replies stamped from the route's X-Served-Model header), so
    // exports stay stable for payloads without model provenance.
    messages: messages.map(({ role, content, model, modelOverridden }) => ({
      role,
      content,
      ...(model ? { model } : {}),
      ...(modelOverridden !== undefined ? { modelOverridden } : {}),
    })),
  }
  return JSON.stringify(payload, null, 2)
}

import type { ChatMessage } from './types'

/**
 * Pure chat-export helpers (Markdown / JSON / plain text) — kept free of DOM
 * so they are unit-testable in Node. PDF export lives in the client via the
 * browser's native Print → Save-as-PDF flow.
 */

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

export interface ChatExportOptions {
  /** Assistant identity included in transcript metadata. */
  assistantName?: string
  /** Include a timestamp next to each message. Defaults to false for compatibility. */
  includeTimestamps?: boolean
  /** Override the export timestamp, primarily useful for tests. */
  exportedAt?: string
}

function exportTimestamp(options: ChatExportOptions): string {
  return options.exportedAt ?? new Date().toISOString()
}

function messageTimestamp(message: ChatMessage, index: number, exportedAt: string): string {
  if (message.createdAt) return message.createdAt
  const base = Date.parse(exportedAt)
  const anchor = Number.isFinite(base) ? base : Date.now()
  // Legacy messages have no stored timestamp. Keep their order while making
  // the generated values deterministic relative to the export timestamp.
  return new Date(anchor - (index + 1) * 1000).toISOString()
}

function metadataLines(options: ChatExportOptions): string[] {
  const lines: string[] = []
  if (options.assistantName) lines.push(`Assistant: ${options.assistantName}`)
  if (options.includeTimestamps) lines.push(`Exported: ${exportTimestamp(options)}`)
  return lines
}

function escapeMarkdown(text: string): string {
  return text.replace(/^#{1,6}\s+/gm, '\\# ').replace(/^\s*([-*+])\s+/gm, '\\$1 ')
}

/** Render a thread as a readable Markdown transcript. */
export function chatToMarkdown(
  messages: ChatMessage[],
  title?: string,
  options: ChatExportOptions = {},
): string {
  const lines: string[] = [`# ${title ?? EXPORT_DEFAULT_TITLE}`, '']
  const metadata = metadataLines(options)
  if (metadata.length > 0) lines.push(...metadata, '')

  const exportedAt = exportTimestamp(options)
  for (const [index, message] of messages.entries()) {
    const label = roleLabel[message.role] ?? message.role
    lines.push(`## ${label}`)
    if (options.includeTimestamps) {
      lines.push('')
      lines.push(`_${messageTimestamp(message, index, exportedAt)}_`)
    }
    if (message.role === 'assistant' && message.model) {
      const tag = message.modelOverridden ? ' (fallback)' : ''
      lines.push('')
      lines.push(`*via ${message.model}${tag}*`)
    }
    lines.push('')
    const body = escapeMarkdown(message.content)
    const paragraphs = body.split(/\n{2,}/)
    if (paragraphs.length > 1) {
      for (const paragraph of paragraphs) {
        lines.push(
          paragraph
            .trim()
            .split('\n')
            .map((line) => `  ${line}`)
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

/** Serialize a thread as JSON with optional transcript metadata. */
export function chatToJson(
  messages: ChatMessage[],
  title?: string,
  options: ChatExportOptions = {},
): string {
  const exportedAt = exportTimestamp(options)
  const includeTimestamps = options.includeTimestamps === true
  const payload = {
    title: title ?? EXPORT_DEFAULT_TITLE,
    ...(options.assistantName ? { assistantName: options.assistantName } : {}),
    ...(includeTimestamps ? { exportedAt } : { exportedAt: new Date().toISOString() }),
    messages: messages.map(({ role, content, model, modelOverridden }, index) => ({
      role,
      content,
      ...(includeTimestamps
        ? { timestamp: messageTimestamp(messages[index]!, index, exportedAt) }
        : {}),
      ...(model ? { model } : {}),
      ...(modelOverridden !== undefined ? { modelOverridden } : {}),
    })),
  }
  return JSON.stringify(payload, null, 2)
}

/** Render a plain-text transcript suitable for notes or PDF conversion. */
export function chatToText(
  messages: ChatMessage[],
  title?: string,
  options: ChatExportOptions = {},
): string {
  const exportedAt = exportTimestamp(options)
  const lines = [title ?? EXPORT_DEFAULT_TITLE, '']
  const metadata = metadataLines(options)
  if (metadata.length > 0) lines.push(...metadata, '')

  for (const [index, message] of messages.entries()) {
    const label = roleLabel[message.role] ?? message.role
    lines.push(label)
    if (options.includeTimestamps) lines.push(messageTimestamp(message, index, exportedAt))
    if (message.role === 'assistant' && message.model) {
      lines.push(`via ${message.model}${message.modelOverridden ? ' (fallback)' : ''}`)
    }
    lines.push('', message.content, '')
  }
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  )
}

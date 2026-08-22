import { z } from 'zod'

/**
 * A message in the chat thread (client state). The Zod schema is the single
 * source of truth: it validates the shape at the localStorage boundary (see
 * lib/storage.ts) and `ChatMessage` is inferred from it.
 */
export const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
})

export type ChatMessage = z.infer<typeof ChatMessageSchema>

/**
 * Wire format sent to /api/chat and forwarded to the LLM API. Zod schema is
 * the source of truth — the route validates request bodies against it.
 */
export const ChatWireMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
})

export type ChatWireMessage = z.infer<typeof ChatWireMessageSchema>

/** Metadata returned after a document has been processed on the server. */
export const UploadedDocumentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  textLength: z.number().int().nonnegative(),
})

export type UploadedDocument = z.infer<typeof UploadedDocumentSchema>

/** A browser-extracted video frame sent only with the current vision request. */
export const VideoFrameSchema = z.object({
  id: z.string().min(1).max(200),
  timestamp: z.number().finite().nonnegative().max(86_400),
  dataUrl: z
    .string()
    .regex(/^data:image\/(?:jpeg|jpg|png);base64,/, 'Frame must be a base64 image data URL.')
    .max(1_200_000),
})

export type VideoFrame = z.infer<typeof VideoFrameSchema>

/** Optional still-image attachment sent only with the current vision request. */
export const ImageDataUrlSchema = z
  .string()
  .regex(/^data:image\/(?:jpeg|jpg|png);base64,/, 'Image must be a base64 JPEG or PNG data URL.')
  .max(1_200_000)

/** Optional audio attachment sent only with the current request. */
export const AudioDataUrlSchema = z
  .string()
  .regex(
    /^data:audio\/(?:mpeg|mp3|wav|x-wav);base64,/,
    'Audio must be a base64 MP3 or WAV data URL.',
  )
  .max(2_000_000)

export type ImageDataUrl = z.infer<typeof ImageDataUrlSchema>
export type AudioDataUrl = z.infer<typeof AudioDataUrlSchema>

/**
 * One SSE event from an OpenAI-compatible chat completions stream: a JSON
 * chunk whose `choices[0].delta` may carry the next token of text.
 */
export interface ChatCompletionChunk {
  choices?: Array<{ delta?: { content?: string } }>
}

/** Result of splitting complete SSE events out of a buffer. */
export interface SSEExtract {
  /** Complete `data:` payloads found in the buffer (JSON strings, or `[DONE]`). */
  events: string[]
  /** Unconsumed tail of the buffer, waiting for the next event boundary. */
  remaining: string
}

/** Callbacks and options for consuming an SSE stream. */
export interface StreamCallbacks {
  onDelta: (text: string) => void
  signal?: AbortSignal
}

// ─── System Prompt Presets ───

/** A user-defined or built-in system prompt preset. */
export interface SystemPromptPreset {
  id: string
  name: string
  prompt: string
}

/** Built-in presets shipped with the app. */
export const BUILTIN_PRESETS: SystemPromptPreset[] = [
  {
    id: 'default',
    name: 'General Assistant',
    prompt: 'You are a helpful assistant.',
  },
  {
    id: 'software-engineer',
    name: 'Software Engineer Expert',
    prompt:
      'You are a senior software engineer. Provide precise, well-structured answers with code examples when applicable. Follow best practices and suggest improvements.',
  },
  {
    id: 'academic-reviewer',
    name: 'Academic Reviewer',
    prompt:
      'You are an academic reviewer. Provide thorough, citation-aware analysis. Be critical but constructive, and clearly separate facts from interpretations.',
  },
  {
    id: 'ui-ux-designer',
    name: 'UI/UX Designer',
    prompt:
      'You are an experienced UI/UX designer. Provide actionable design feedback, suggest improvements for usability and accessibility, and reference modern design principles.',
  },
  {
    id: 'creative-writer',
    name: 'Creative Writer',
    prompt:
      'You are a creative writing assistant. Help with storytelling, character development, dialogue, and prose. Be imaginative and offer alternatives.',
  },
]

// ─── Chat Session (extended) ───

/** Session summary extended with pin/archive metadata. */
export interface ChatSessionSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
  pinned: boolean
  archived: boolean
  systemPrompt?: string | null
}

// ─── User Preferences ───

/** User preferences stored in the DB. */
export interface UserPreferences {
  displayName: string
  avatarUrl: string
  apiKey: string
  systemPromptPresets: SystemPromptPreset[]
}

// ─── Command Palette ───

/** Command palette action item. */
export interface CommandAction {
  id: string
  label: string
  description?: string
  icon?: string
  shortcut?: string
  action: () => void
  section: string
}

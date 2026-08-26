import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const EMBED_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

const EmbedPayloadSchema = z.object({
  agentId: z.string().min(1).max(100),
  userId: z.string().min(1).max(100),
  origin: z.string().max(2_000),
  exp: z.number().int().positive(),
})

export type EmbedPayload = z.infer<typeof EmbedPayloadSchema>

function secret(): string {
  return process.env.AUTH_SECRET || 'local-development-embed-secret'
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signature(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** Create a bearer token that can only be used for one owned assistant. */
export function createEmbedToken(input: {
  agentId: string
  userId: string
  origin?: string
  now?: number
}): string {
  const payload = EmbedPayloadSchema.parse({
    agentId: input.agentId,
    userId: input.userId,
    origin: normalizeEmbedOrigin(input.origin),
    exp: Math.floor((input.now ?? Date.now()) / 1000) + EMBED_TOKEN_TTL_SECONDS,
  })
  const encoded = encode(JSON.stringify(payload))
  return `${encoded}.${signature(encoded)}`
}

/** Verify a token and optionally enforce the request origin. */
export function verifyEmbedToken(
  token: string | null | undefined,
  expectedAgentId: string,
  requestOrigin?: string | null,
  now = Date.now(),
): EmbedPayload | null {
  if (!token) return null
  const [encoded, suppliedSignature] = token.split('.')
  if (!encoded || !suppliedSignature) return null
  const expectedSignature = signature(encoded)
  const supplied = Buffer.from(suppliedSignature)
  const expected = Buffer.from(expectedSignature)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null

  let payload: EmbedPayload
  try {
    payload = EmbedPayloadSchema.parse(JSON.parse(decode(encoded)))
  } catch {
    return null
  }
  if (payload.agentId !== expectedAgentId || payload.exp <= Math.floor(now / 1000)) return null
  if (payload.origin !== '*' && requestOrigin && payload.origin !== requestOrigin) return null
  return payload
}

/** Validate the optional allow-listed origin supplied by the embed generator. */
export function normalizeEmbedOrigin(origin: string | undefined): string {
  const value = origin?.trim() || '*'
  if (value === '*') return value
  const parsed = new URL(value)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Embed origin must use HTTP or HTTPS.')
  }
  return parsed.origin
}

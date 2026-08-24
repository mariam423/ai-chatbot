/**
 * Shared JSON response helpers for API routes.
 *
 * Every route returns errors as `{ error: string }` with an HTTP status; this
 * wrapper keeps that shape consistent and removes the per-route copy-paste.
 */

import { NextResponse } from 'next/server'

/** A `{ error }` JSON response with the given status (defaults to 400). */
export function errorResponse(error: string, status = 400): NextResponse {
  return NextResponse.json({ error }, { status })
}

'use client'

import { lazy, Suspense } from 'react'
import { parseStructuredResponse, renderStructuredResponse } from '@/lib/structured-output'
import Markdown from './markdown'

// Recharts is a heavy dependency — lazy-load the chart so it ships as its own
// chunk, fetched only when an assistant reply actually contains a chart.
const StructuredChart = lazy(() => import('./structured-chart'))

interface StructuredResponseProps {
  content: string
  sessionId: string | null
}

/** Render a strict model envelope without allowing model-controlled components or markup. */
export default function StructuredResponse({ content, sessionId }: StructuredResponseProps) {
  const response = parseStructuredResponse(content)
  if (!response) return <Markdown content={content} sessionId={sessionId} />

  if (response.kind !== 'chart' || response.chart.length === 0) {
    return <Markdown content={renderStructuredResponse(content)} sessionId={sessionId} />
  }

  return (
    <div className="space-y-3">
      {response.content && <Markdown content={response.content} sessionId={sessionId} />}
      <Suspense
        fallback={
          <div
            className="flex h-64 w-full items-center justify-center rounded-xl"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
          >
            <span className="text-xs text-[var(--text-tertiary)]">Loading chart…</span>
          </div>
        }
      >
        <StructuredChart points={response.chart} />
      </Suspense>
    </div>
  )
}

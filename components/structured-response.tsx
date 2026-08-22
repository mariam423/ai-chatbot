'use client'

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { parseStructuredResponse, renderStructuredResponse } from '@/lib/structured-output'
import Markdown from './markdown'

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
      <div
        className="h-64 w-full rounded-xl p-3"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
        role="img"
        aria-label="Interactive time-series chart"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={response.chart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="3 3" />
            <XAxis dataKey="timestamp" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
            <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
            <Tooltip
              contentStyle={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                color: 'var(--text-primary)',
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--accent)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--accent)' }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

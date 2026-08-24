'use client'

import { z } from 'zod'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ChartPointSchema } from '@/lib/structured-output'

type ChartPoint = z.infer<typeof ChartPointSchema>

/**
 * Chart rendering for structured "chart" responses. Split into its own module
 * (loaded via React.lazy from structured-response.tsx) so the recharts bundle
 * is only fetched when an assistant reply actually contains a chart.
 */
export default function StructuredChart({ points }: { points: ChartPoint[] }) {
  const data = points.map((point) => ({ timestamp: point.timestamp, value: point.value }))
  return (
    <div className="mt-3 h-72 w-full overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey="timestamp" stroke="var(--text-tertiary)" fontSize={11} />
          <YAxis stroke="var(--text-tertiary)" fontSize={11} />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              color: 'var(--text-primary)',
            }}
          />
          <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

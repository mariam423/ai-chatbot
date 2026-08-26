import type { CustomAgentSummary } from '@/lib/types'

export interface DashboardData {
  usage: { messages: number; tokens: number }
  billing: {
    plan: string
    planLabel: string
    dailyLimit: number | null
    usedToday: number
    estimatedTokensToday: number
    overLimit: boolean
    stripeConfigured: boolean
  }
  agents: CustomAgentSummary[]
  admin: {
    users: number
    proUsers: number
    messages: number
    documents: number
    database: 'ok' | 'degraded'
  } | null
}

import Link from 'next/link'
import { getDashboardData } from '@/app/actions'
import CustomAgentManager from '@/components/custom-agent-manager'

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--text-tertiary)]">{detail}</p>
    </div>
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string | string[] }>
}) {
  const result = await getDashboardData()
  if (!result.ok) {
    return (
      <main
        className="flex min-h-dvh items-center justify-center p-6"
        style={{ background: 'var(--bg-deep)' }}
      >
        <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--bg-card)' }}>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            Dashboard unavailable
          </h1>
          <p className="mt-2 text-sm text-[var(--text-secondary)]">{result.error}</p>
          <Link className="mt-4 inline-block text-sm text-emerald-500" href="/">
            Return to chat
          </Link>
        </div>
      </main>
    )
  }

  const { usage, billing, agents, admin } = result.data
  const params = searchParams ? await searchParams : {}
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view
  const activeView = requestedView === 'admin' && admin ? 'admin' : 'overview'
  const quota =
    billing.dailyLimit === null ? null : Math.min(100, (usage.messages / billing.dailyLimit) * 100)

  return (
    <main className="min-h-dvh px-4 py-8" style={{ background: 'var(--bg-deep)' }}>
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500">
              Control room
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">
              Usage & Analytics
            </h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Your AI activity, quota, assistants, and subscription health.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-xl px-4 py-2 text-sm text-[var(--text-secondary)]"
            style={{ border: '1px solid var(--border-medium)' }}
          >
            Back to chat
          </Link>
        </header>

        <nav
          aria-label="Dashboard views"
          className="flex w-fit items-center gap-1 rounded-xl p-1"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
        >
          <Link
            href="/dashboard"
            role="tab"
            aria-selected={activeView === 'overview'}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              activeView === 'overview'
                ? 'bg-emerald-500 text-white'
                : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            Overview
          </Link>
          {admin && (
            <Link
              href="/dashboard?view=admin"
              role="tab"
              aria-selected={activeView === 'admin'}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeView === 'admin'
                  ? 'bg-emerald-500 text-white'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              Admin
            </Link>
          )}
        </nav>

        {activeView === 'overview' && (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Plan"
                value={billing.planLabel}
                detail={
                  billing.dailyLimit === null
                    ? 'Unlimited messages'
                    : `${billing.dailyLimit} messages per day`
                }
              />
              <StatCard
                label="Messages today"
                value={String(usage.messages)}
                detail={
                  billing.dailyLimit === null
                    ? 'No daily cap'
                    : `${Math.max(0, billing.dailyLimit - usage.messages)} remaining`
                }
              />
              <StatCard
                label="Estimated tokens"
                value={usage.tokens.toLocaleString()}
                detail="Input-token estimate for today"
              />
              <StatCard
                label="Custom assistants"
                value={String(agents.length)}
                detail="Private to your account"
              />
            </section>

            <section className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div
                className="rounded-2xl p-5"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                      Daily quota
                    </h2>
                    <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                      FREE and PRO usage is enforced server-side before provider calls.
                    </p>
                  </div>
                  <span className="font-mono text-sm text-emerald-500">
                    {billing.dailyLimit === null ? '∞' : `${usage.messages}/${billing.dailyLimit}`}
                  </span>
                </div>
                <div
                  className="mt-5 h-3 overflow-hidden rounded-full"
                  style={{ background: 'var(--bg-input)' }}
                >
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${quota ?? 8}%` }}
                  />
                </div>
                <p className="mt-3 text-xs text-[var(--text-tertiary)]">
                  {billing.overLimit
                    ? 'Quota reached. Upgrade to Pro for unlimited requests.'
                    : billing.dailyLimit === null
                      ? 'Your Pro subscription has no daily message cap.'
                      : `${Math.max(0, billing.dailyLimit - usage.messages)} messages remain today.`}
                </p>
              </div>
              <div
                className="rounded-2xl p-5"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
              >
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Stripe subscription
                </h2>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-tertiary)]">Status</span>
                    <span className="font-medium text-[var(--text-primary)]">
                      {billing.plan === 'pro' ? 'Active Pro' : 'Free tier'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-tertiary)]">Checkout</span>
                    <span className="text-[var(--text-secondary)]">
                      {billing.stripeConfigured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                  <Link
                    href="/settings"
                    className="mt-2 inline-block text-xs font-medium text-emerald-500"
                  >
                    Manage billing in Settings →
                  </Link>
                </div>
              </div>
            </section>

            <section
              className="rounded-2xl p-5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                    Custom AI assistants
                  </h2>
                  <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                    Create private personas with their own system prompt, baseline model, and tool
                    switches.
                  </p>
                </div>
                <span className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-500">
                  Available in chat header
                </span>
              </div>
              <div className="mt-4">
                <CustomAgentManager initialAgents={agents} />
              </div>
            </section>
          </>
        )}

        {activeView === 'admin' && admin && (
          <section
            className="rounded-2xl p-5"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--gold-border)' }}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                  Admin platform metrics
                </h2>
                <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                  Aggregated activity and system health. No message content is exposed.
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-500">
                ADMIN
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Users"
                value={String(admin.users)}
                detail={`${admin.proUsers} Pro users`}
              />
              <StatCard
                label="Messages"
                value={String(admin.messages)}
                detail="Persisted messages"
              />
              <StatCard label="Documents" value={String(admin.documents)} detail="Uploaded files" />
              <StatCard
                label="Health"
                value={admin.database === 'ok' ? 'Operational' : 'Degraded'}
                detail={admin.database === 'ok' ? 'Database reachable' : 'Database check failed'}
              />
            </div>
          </section>
        )}
      </div>
    </main>
  )
}

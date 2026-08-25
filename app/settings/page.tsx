'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  UserIcon,
  Key02Icon,
  Settings02Icon,
  CheckIcon,
  ArrowLeft01Icon,
  Calendar01Icon,
  CircleGaugeIcon,
} from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import {
  getBillingStatus,
  getUserPreferences,
  openBillingPortal,
  testGoogleCalendarConnection,
  updateUserPreferences,
  upgradeToPro,
} from '@/app/actions'
import { BUILTIN_PRESETS, type SystemPromptPreset } from '@/lib/types'
import { MODEL_OPTIONS } from '@/lib/models'
import { pageTitle } from '@/lib/seo'
import { EVENTS, useAnalytics } from '@/lib/use-analytics'
import { useViewTransitionRouter } from '@/hooks/use-view-transition-router'

/**
 * Client-side Zod validation for the generation-tuning controls. Values are
 * checked in real time as the sliders move, and only valid values are
 * persisted — mirroring the server-side schema in app/actions.ts.
 */
const TemperatureSchema = z.number().min(0).max(1)
const MaxCompletionTokensSchema = z.number().int().min(256).max(16384)

/**
 * Temperature slider (0.0–1.0). The value is re-validated against
 * TemperatureSchema on every change; the current state + an inline error (if
 * the value ever escaped the valid range) are shown live.
 */
function TemperatureControl({
  value,
  onChange,
}: {
  value: number | null
  onChange: (next: number | null) => void
}) {
  const result = useMemo(() => TemperatureSchema.safeParse(value), [value])
  // null means "provider default" — a valid state, not an out-of-range value.
  const invalid = value !== null && !result.success
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor="settings-temperature"
          className="text-xs font-medium text-[var(--text-secondary)]"
        >
          Temperature
        </label>
        <span
          className={`font-mono text-xs ${invalid ? 'text-red-500' : 'text-[var(--text-secondary)]'}`}
        >
          {value === null ? 'default' : value.toFixed(2)}
        </span>
      </div>
      <input
        id="settings-temperature"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={value ?? 0.7}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
        aria-invalid={invalid}
      />
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-tertiary)]">
        <span>0.0</span>
        <span>1.0</span>
      </div>
      {invalid && (
        <p role="alert" className="mt-1 text-[11px] text-red-500">
          Temperature must be between 0.0 and 1.0.
        </p>
      )}
    </div>
  )
}

/**
 * Max completion tokens slider (256–16384). Re-validated against
 * MaxCompletionTokensSchema in real time; only valid integers persist.
 */
function MaxTokensControl({
  value,
  onChange,
  defaultValue,
}: {
  value: number | null
  onChange: (next: number | null) => void
  /** Effective server-side cap applied when the user leaves this unset. */
  defaultValue: number | null
}) {
  const result = useMemo(() => MaxCompletionTokensSchema.safeParse(value), [value])
  // null means "server default" — a valid state, not an out-of-range value.
  const invalid = value !== null && !result.success
  const unset = value === null
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label
          htmlFor="settings-max-tokens"
          className="text-xs font-medium text-[var(--text-secondary)]"
        >
          Max Completion Tokens
        </label>
        <span
          className={`font-mono text-xs ${invalid ? 'text-red-500' : 'text-[var(--text-secondary)]'}`}
        >
          {unset
            ? defaultValue !== null
              ? `${defaultValue.toLocaleString()} (server default)`
              : 'default'
            : value.toLocaleString()}
        </span>
      </div>
      <input
        id="settings-max-tokens"
        type="range"
        min="256"
        max="16384"
        step="256"
        value={value ?? 2048}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-emerald-500"
        aria-invalid={invalid}
      />
      <div className="mt-1 flex justify-between text-[10px] text-[var(--text-tertiary)]">
        <span>256</span>
        <span>16,384</span>
      </div>
      {unset && defaultValue !== null && (
        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
          When unset, each reply is capped at {defaultValue.toLocaleString()} tokens server-side
          (configured via MAX_OUTPUT_TOKENS).
        </p>
      )}
      {invalid && (
        <p role="alert" className="mt-1 text-[11px] text-red-500">
          Max tokens must be a whole number between 256 and 16,384.
        </p>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const { data: session } = useSession()
  const { navigate } = useViewTransitionRouter()
  const reducedMotion = useReducedMotion()
  const { track } = useAnalytics()

  // Billing state: current plan, usage, and Stripe availability.
  const [billing, setBilling] = useState<{
    plan: string
    planLabel: string
    dailyLimit: number | null
    usedToday: number
    overLimit: boolean
    stripeConfigured: boolean
  } | null>(null)
  const [billingAction, setBillingAction] = useState<'upgrade' | 'portal' | null>(null)

  // Dynamic page title (this is a client page, so set it directly).
  useEffect(() => {
    document.title = pageTitle('Settings')
  }, [])

  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [presets, setPresets] = useState<SystemPromptPreset[]>([])
  const [newPresetName, setNewPresetName] = useState('')
  const [newPresetPrompt, setNewPresetPrompt] = useState('')
  const [googleCalendarId, setGoogleCalendarId] = useState('')
  const [googleServiceAccountKey, setGoogleServiceAccountKey] = useState('')
  const [preferredModel, setPreferredModel] = useState('')
  const [temperature, setTemperature] = useState<number | null>(null)
  const [maxCompletionTokens, setMaxCompletionTokens] = useState<number | null>(null)
  const [defaultMaxCompletionTokens, setDefaultMaxCompletionTokens] = useState<number | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ name: '', prompt: '' })

  useEffect(() => {
    void getBillingStatus().then((result) => {
      if (result.ok) setBilling(result.data)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const result = await getUserPreferences()
      if (cancelled || !result.ok) return
      setDisplayName(result.data.displayName)
      setAvatarUrl(result.data.avatarUrl)
      setApiKey(result.data.apiKey)
      setGoogleCalendarId(result.data.googleCalendarId)
      setGoogleServiceAccountKey(result.data.googleServiceAccountKey)
      setPreferredModel(result.data.preferredModel)
      setTemperature(result.data.temperature)
      setMaxCompletionTokens(result.data.maxCompletionTokens)
      setDefaultMaxCompletionTokens(result.data.defaultMaxCompletionTokens)
      try {
        setPresets(JSON.parse(result.data.systemPromptPresets) as SystemPromptPreset[])
      } catch {
        setPresets([])
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async () => {
    setSaving(true)
    setSaved(false)
    setError(null)
    const result = await updateUserPreferences({
      displayName,
      avatarUrl,
      apiKey,
      systemPromptPresets: JSON.stringify(presets),
      googleCalendarId,
      googleServiceAccountKey,
      preferredModel,
      ...(temperature !== null ? { temperature } : {}),
      ...(maxCompletionTokens !== null ? { maxCompletionTokens } : {}),
    })
    setSaving(false)
    if (result.ok) {
      setSaved(true)
      setTestResult(null)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(result.error)
    }
  }, [
    displayName,
    avatarUrl,
    apiKey,
    presets,
    googleCalendarId,
    googleServiceAccountKey,
    preferredModel,
    temperature,
    maxCompletionTokens,
  ])

  const testConnection = useCallback(async () => {
    setTesting(true)
    setTestResult(null)
    setError(null)
    const result = await testGoogleCalendarConnection()
    setTesting(false)
    if (result.ok) {
      setTestResult(result.message)
    } else {
      setError(result.error)
    }
  }, [])

  async function handleUpgrade() {
    if (billingAction) return
    setBillingAction('upgrade')
    setError(null)
    track(EVENTS.upgradeClicked)
    const result = await upgradeToPro()
    setBillingAction(null)
    if (!result.ok) {
      setError(
        result.notConfigured
          ? 'Stripe billing is not configured on this server yet.'
          : result.error,
      )
      return
    }
    window.location.href = result.url
  }

  async function handleManageBilling() {
    if (billingAction) return
    setBillingAction('portal')
    setError(null)
    const result = await openBillingPortal()
    setBillingAction(null)
    if (!result.ok) {
      setError(
        result.notConfigured
          ? 'Stripe billing is not configured on this server yet.'
          : result.error,
      )
      return
    }
    window.location.href = result.url
  }

  function addPreset() {
    const name = newPresetName.trim()
    const prompt = newPresetPrompt.trim()
    if (!name || !prompt) return
    const id = `custom-${Date.now()}`
    setPresets((prev) => [...prev, { id, name, prompt }])
    setNewPresetName('')
    setNewPresetPrompt('')
  }

  function removePreset(id: string) {
    setPresets((prev) => prev.filter((p) => p.id !== id))
  }

  function startEditPreset(preset: SystemPromptPreset) {
    setEditingPresetId(preset.id)
    setEditDraft({ name: preset.name, prompt: preset.prompt })
  }

  function saveEditPreset() {
    if (!editingPresetId) return
    setPresets((prev) =>
      prev.map((p) =>
        p.id === editingPresetId
          ? {
              ...p,
              name: editDraft.name.trim() || p.name,
              prompt: editDraft.prompt.trim() || p.prompt,
            }
          : p,
      ),
    )
    setEditingPresetId(null)
  }

  if (loading) {
    return (
      <div
        className="flex h-dvh items-center justify-center"
        style={{ background: 'var(--bg-deep)' }}
      >
        <div className="skeleton-bar h-8 w-48" />
      </div>
    )
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-deep)' }}>
      <header
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <motion.button
          type="button"
          onClick={() => navigate('/')}
          whileHover={reducedMotion ? undefined : { scale: 1.05 }}
          whileTap={reducedMotion ? undefined : { scale: 0.95 }}
          aria-label="Back to chat"
          className="flex size-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={20} strokeWidth={1.5} />
        </motion.button>
        <HugeiconsIcon
          icon={Settings02Icon}
          size={18}
          strokeWidth={1.5}
          className="text-[var(--text-secondary)]"
        />
        <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          Settings
        </h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-6 p-4 py-8">
        {error && (
          <div
            role="alert"
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{
              background: 'var(--error-bg)',
              border: '1px solid var(--error-border)',
              color: 'var(--error-text)',
            }}
          >
            {error}
          </div>
        )}

        {/* ─── Profile Section ─── */}
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <HugeiconsIcon
              icon={UserIcon}
              size={16}
              strokeWidth={1.5}
              className="text-emerald-500"
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Profile</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="settings-name"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Display Name
              </label>
              <input
                id="settings-name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                className="focus-glow w-full rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
              />
            </div>
            <div>
              <label
                htmlFor="settings-avatar"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Avatar URL
              </label>
              <input
                id="settings-avatar"
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://example.com/avatar.png"
                className="focus-glow w-full rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
              />
            </div>
            {session?.user?.email && (
              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
                  Email
                </span>
                <span className="text-sm text-[var(--text-tertiary)]">{session.user.email}</span>
              </div>
            )}
          </div>
        </motion.section>

        {/* ─── Model & Generation Section ─── */}
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <HugeiconsIcon
              icon={Settings02Icon}
              size={16}
              strokeWidth={1.5}
              className="text-emerald-500"
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Model & Generation</h2>
          </div>
          <div className="space-y-5">
            {/* Preferred default model */}
            <div>
              <label
                htmlFor="settings-model"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Preferred Default Model
              </label>
              <select
                id="settings-model"
                value={preferredModel}
                onChange={(e) => setPreferredModel(e.target.value)}
                className="focus-glow w-full rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
              >
                <option value="">Provider default</option>
                {MODEL_OPTIONS.filter((option) => option.model !== null).map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                Used as the default model for new chats. You can still switch per chat from the
                header dropdown.
              </p>
            </div>

            {/* Temperature slider with real-time Zod validation */}
            <TemperatureControl value={temperature} onChange={setTemperature} />

            {/* Max completion tokens slider with real-time Zod validation */}
            <MaxTokensControl
              value={maxCompletionTokens}
              onChange={setMaxCompletionTokens}
              defaultValue={defaultMaxCompletionTokens}
            />
          </div>
        </motion.section>

        {/* ─── Plan & Billing Section ─── */}
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05 }}
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <HugeiconsIcon
              icon={CircleGaugeIcon}
              size={16}
              strokeWidth={1.5}
              className="text-emerald-500"
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Plan & Billing</h2>
          </div>
          {billing ? (
            <div className="space-y-4">
              <div
                className="flex items-center justify-between rounded-xl px-4 py-3"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-subtle)' }}
              >
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    {billing.planLabel} plan
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                    {billing.dailyLimit === null
                      ? 'Unlimited daily chat requests'
                      : `${billing.usedToday} of ${billing.dailyLimit} daily chat requests used`}
                  </p>
                </div>
                {billing.plan === 'pro' ? (
                  <button
                    type="button"
                    onClick={() => void handleManageBilling()}
                    disabled={billingAction !== null}
                    className="rounded-xl px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                    style={{ border: '1px solid var(--border-medium)' }}
                  >
                    {billingAction === 'portal' ? 'Opening…' : 'Manage billing'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void handleUpgrade()}
                    disabled={billingAction !== null}
                    className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    {billingAction === 'upgrade' ? 'Starting…' : 'Upgrade to Pro'}
                  </button>
                )}
              </div>
              {billing.overLimit && (
                <p role="alert" className="text-xs text-red-500">
                  You&apos;ve reached your daily request limit — upgrade to Pro for unlimited
                  requests.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-[var(--text-tertiary)]">Loading billing status…</p>
          )}
        </motion.section>

        {/* ─── API Key Section ─── */}
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <HugeiconsIcon
              icon={Key02Icon}
              size={16}
              strokeWidth={1.5}
              className="text-emerald-500"
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">API Key</h2>
          </div>
          <p className="mb-3 text-xs text-[var(--text-tertiary)]">
            Provide your own provider API key to use your personal quota instead of the shared key.
            OpenRouter (<span className="font-mono">sk-or-…</span>), Gemini (
            <span className="font-mono">AIza…</span>), and OpenAI (<span className="font-mono">sk-…</span>
            ) keys are detected automatically. Stored encrypted at rest.
          </p>
          <div className="relative">
            <label htmlFor="settings-apikey" className="sr-only">
              API Key
            </label>
            <input
              id="settings-apikey"
              type={showApiKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-or-... or AIza..."
              className="focus-glow w-full rounded-xl px-3 py-2.5 pr-20 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-input-hover)] hover:text-[var(--text-secondary)]"
            >
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </motion.section>

        {/* ─── Google Calendar ─── */}
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <HugeiconsIcon
              icon={Calendar01Icon}
              size={16}
              strokeWidth={1.5}
              className="text-emerald-500"
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Google Calendar</h2>
          </div>
          <p className="mb-3 text-xs text-[var(--text-tertiary)]">
            Connect a service account so the{' '}
            <span className="font-mono text-[var(--text-secondary)]">schedule_block</span> skill can
            create real events. Share your calendar with the service account email (Calendar
            settings → Share with specific people) and paste its JSON key below. Leave blank to use
            the server&apos;s GOOGLE_* environment variables.
          </p>
          <div className="space-y-4">
            <div>
              <label
                htmlFor="settings-calendar-id"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Calendar ID
              </label>
              <input
                id="settings-calendar-id"
                type="text"
                value={googleCalendarId}
                onChange={(e) => setGoogleCalendarId(e.target.value)}
                placeholder="primary or someone@example.com"
                className="focus-glow w-full rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
              />
            </div>
            <div>
              <label
                htmlFor="settings-calendar-key"
                className="mb-1 block text-xs font-medium text-[var(--text-secondary)]"
              >
                Service Account Key (JSON)
              </label>
              <textarea
                id="settings-calendar-key"
                value={googleServiceAccountKey}
                onChange={(e) => setGoogleServiceAccountKey(e.target.value)}
                rows={6}
                placeholder='{ "client_email": "...", "private_key": "-----BEGIN PRIVATE KEY-----" }'
                className="focus-glow w-full resize-y rounded-xl px-3 py-2.5 font-mono text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void testConnection()}
                disabled={testing}
                className="rounded-xl border px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-input)] disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: 'var(--border-medium)' }}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              {testResult && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-500">
                  <HugeiconsIcon icon={CheckIcon} size={12} strokeWidth={2} />
                  {testResult}
                </span>
              )}
            </div>
          </div>
        </motion.section>

        {/* ─── System Prompt Presets ─── */}
        <motion.section
          initial={reducedMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
          className="rounded-2xl p-5"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--glass-shadow)',
          }}
        >
          <div className="mb-4 flex items-center gap-2">
            <HugeiconsIcon
              icon={Settings02Icon}
              size={16}
              strokeWidth={1.5}
              className="text-emerald-500"
            />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              System Prompt Presets
            </h2>
          </div>

          {/* Built-in presets */}
          <div className="mb-4">
            <h3 className="mb-2 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
              Built-in
            </h3>
            <div className="space-y-2">
              {BUILTIN_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-xl px-3 py-2.5"
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <p className="text-sm font-medium text-[var(--text-primary)]">{preset.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-tertiary)]">
                    {preset.prompt}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Custom presets */}
          {presets.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider">
                Custom
              </h3>
              <div className="space-y-2">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="group flex items-start gap-2 rounded-xl px-3 py-2.5"
                    style={{
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border-subtle)',
                    }}
                  >
                    {editingPresetId === preset.id ? (
                      <div className="flex-1 space-y-2">
                        <input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          className="focus-glow w-full rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
                          style={{
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-medium)',
                          }}
                        />
                        <textarea
                          value={editDraft.prompt}
                          onChange={(e) => setEditDraft((d) => ({ ...d, prompt: e.target.value }))}
                          rows={3}
                          className="focus-glow w-full resize-none rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
                          style={{
                            background: 'var(--bg-input)',
                            border: '1px solid var(--border-medium)',
                          }}
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={saveEditPreset}
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white"
                          >
                            <HugeiconsIcon icon={CheckIcon} size={10} strokeWidth={2} />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingPresetId(null)}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-muted)] hover:bg-[var(--bg-input)]"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)]">
                            {preset.name}
                          </p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-tertiary)]">
                            {preset.prompt}
                          </p>
                        </div>
                        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => startEditPreset(preset)}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-input)]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => removePreset(preset.id)}
                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-red-500 hover:bg-red-500/10"
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add new preset */}
          <div
            className="rounded-xl p-3"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
          >
            <h3 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">
              Add Custom Preset
            </h3>
            <div className="space-y-2">
              <input
                value={newPresetName}
                onChange={(e) => setNewPresetName(e.target.value)}
                placeholder="Preset name"
                className="focus-glow w-full rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
              />
              <textarea
                value={newPresetPrompt}
                onChange={(e) => setNewPresetPrompt(e.target.value)}
                placeholder="System prompt..."
                rows={3}
                className="focus-glow w-full resize-none rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
              />
              <button
                type="button"
                onClick={addPreset}
                disabled={!newPresetName.trim() || !newPresetPrompt.trim()}
                className="rounded-xl px-3 py-2 text-sm font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-30"
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #0d9488 100%)',
                  boxShadow: '0 2px 12px rgba(8,145,178,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
                }}
              >
                Add Preset
              </button>
            </div>
          </div>
        </motion.section>

        {/* ─── Save Button ─── */}
        <div className="flex justify-end">
          <motion.button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            whileHover={reducedMotion ? undefined : { scale: 1.02 }}
            whileTap={reducedMotion ? undefined : { scale: 0.98 }}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-medium text-white transition-all disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              background: saved
                ? 'linear-gradient(135deg, #059669 0%, #10b981 100%)'
                : 'linear-gradient(135deg, #10b981 0%, #0d9488 100%)',
              boxShadow: saved
                ? '0 2px 12px rgba(16,185,129,0.25)'
                : '0 2px 12px rgba(8,145,178,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
          >
            {saving ? (
              'Saving...'
            ) : saved ? (
              <>
                <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={2} />
                Saved
              </>
            ) : (
              'Save Changes'
            )}
          </motion.button>
        </div>
      </div>
    </div>
  )
}

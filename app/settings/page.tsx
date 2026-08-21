'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  UserIcon,
  Key02Icon,
  Settings02Icon,
  CheckIcon,
  ArrowLeft01Icon,
} from '@hugeicons/core-free-icons'
import { motion, useReducedMotion } from 'framer-motion'
import { useSession } from 'next-auth/react'
import { useCallback, useEffect, useState } from 'react'
import { getUserPreferences, updateUserPreferences } from '@/app/actions'
import { BUILTIN_PRESETS, type SystemPromptPreset } from '@/lib/types'
import { useViewTransitionRouter } from '@/hooks/use-view-transition-router'

export default function SettingsPage() {
  const { data: session } = useSession()
  const { navigate } = useViewTransitionRouter()
  const reducedMotion = useReducedMotion()

  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [presets, setPresets] = useState<SystemPromptPreset[]>([])
  const [newPresetName, setNewPresetName] = useState('')
  const [newPresetPrompt, setNewPresetPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ name: '', prompt: '' })

  useEffect(() => {
    let cancelled = false
    async function load() {
      const result = await getUserPreferences()
      if (cancelled || !result.ok) return
      setDisplayName(result.data.displayName)
      setAvatarUrl(result.data.avatarUrl)
      setApiKey(result.data.apiKey)
      try {
        setPresets(JSON.parse(result.data.systemPromptPresets) as SystemPromptPreset[])
      } catch {
        setPresets([])
      }
      setLoading(false)
    }
    void load()
    return () => { cancelled = true }
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
    })
    setSaving(false)
    if (result.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } else {
      setError(result.error)
    }
  }, [displayName, avatarUrl, apiKey, presets])

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
          ? { ...p, name: editDraft.name.trim() || p.name, prompt: editDraft.prompt.trim() || p.prompt }
          : p,
      ),
    )
    setEditingPresetId(null)
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center" style={{ background: 'var(--bg-deep)' }}>
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
        <HugeiconsIcon icon={Settings02Icon} size={18} strokeWidth={1.5} className="text-[var(--text-secondary)]" />
        <h1 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">Settings</h1>
      </header>

      <div className="mx-auto max-w-2xl space-y-6 p-4 py-8">
        {error && (
          <div
            role="alert"
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{ background: 'var(--error-bg)', border: '1px solid var(--error-border)', color: 'var(--error-text)' }}
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
            <HugeiconsIcon icon={UserIcon} size={16} strokeWidth={1.5} className="text-cyan-500" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Profile</h2>
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="settings-name" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
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
              <label htmlFor="settings-avatar" className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">
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
                <span className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Email</span>
                <span className="text-sm text-[var(--text-tertiary)]">{session.user.email}</span>
              </div>
            )}
          </div>
        </motion.section>

        {/* ─── API Key Section ─── */}
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
            <HugeiconsIcon icon={Key02Icon} size={16} strokeWidth={1.5} className="text-cyan-500" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">API Key</h2>
          </div>
          <p className="mb-3 text-xs text-[var(--text-tertiary)]">
            Provide your own OpenRouter API key to use your personal quota instead of the shared key.
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
              placeholder="sk-or-..."
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
            <HugeiconsIcon icon={Settings02Icon} size={16} strokeWidth={1.5} className="text-cyan-500" />
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">System Prompt Presets</h2>
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
                  style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                >
                  <p className="text-sm font-medium text-[var(--text-primary)]">{preset.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-tertiary)]">{preset.prompt}</p>
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
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
                  >
                    {editingPresetId === preset.id ? (
                      <div className="flex-1 space-y-2">
                        <input
                          value={editDraft.name}
                          onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                          className="focus-glow w-full rounded-lg px-2 py-1 text-sm text-[var(--text-primary)] outline-none"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
                        />
                        <textarea
                          value={editDraft.prompt}
                          onChange={(e) => setEditDraft((d) => ({ ...d, prompt: e.target.value }))}
                          rows={3}
                          className="focus-glow w-full resize-none rounded-lg px-2 py-1 text-xs text-[var(--text-primary)] outline-none"
                          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
                        />
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={saveEditPreset}
                            className="inline-flex items-center gap-1 rounded-lg bg-cyan-600 px-2 py-1 text-[11px] font-medium text-white"
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
                          <p className="text-sm font-medium text-[var(--text-primary)]">{preset.name}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-[var(--text-tertiary)]">{preset.prompt}</p>
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
          <div className="rounded-xl p-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
            <h3 className="mb-2 text-xs font-medium text-[var(--text-tertiary)]">Add Custom Preset</h3>
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
                  background: 'linear-gradient(135deg, #0891B2 0%, #4F46E5 100%)',
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
                : 'linear-gradient(135deg, #0891B2 0%, #4F46E5 100%)',
              boxShadow: saved
                ? '0 2px 12px rgba(16,185,129,0.25)'
                : '0 2px 12px rgba(8,145,178,0.25), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
          >
            {saving ? 'Saving...' : saved ? (
              <>
                <HugeiconsIcon icon={CheckIcon} size={14} strokeWidth={2} />
                Saved
              </>
            ) : 'Save Changes'}
          </motion.button>
        </div>
      </div>
    </div>
  )
}

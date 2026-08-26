'use client'

import { useState } from 'react'
import { deleteCustomAgent, saveCustomAgent } from '@/app/actions'
import { MODEL_OPTIONS } from '@/lib/models'
import { CustomAgentThemeSchema, type CustomAgentSummary } from '@/lib/types'
import EmbedGenerator from './embed-generator'

const ASSISTANT_TOOLS = [
  { id: 'web_search', label: 'Web search' },
  { id: 'code_interpreter', label: 'Code interpreter' },
  { id: 'image_inspect', label: 'Image inspection' },
  { id: 'audio_transcribe', label: 'Audio transcription' },
  { id: 'audio_synthesize', label: 'Audio synthesis' },
]

export default function CustomAgentManager({
  initialAgents,
}: {
  initialAgents: CustomAgentSummary[]
}) {
  const [agents, setAgents] = useState(initialAgents)
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [baselineModel, setBaselineModel] = useState('')
  const [selectedTools, setSelectedTools] = useState<string[]>([])
  const [theme, setTheme] = useState('emerald')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || !prompt.trim() || saving) return
    setSaving(true)
    setError(null)
    const result = await saveCustomAgent({
      name,
      systemPrompt: prompt,
      baselineModel,
      selectedTools,
      theme,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setAgents((current) => [result.agent, ...current])
    setName('')
    setPrompt('')
    setBaselineModel('')
    setSelectedTools([])
    setTheme('emerald')
  }

  async function remove(id: string) {
    const result = await deleteCustomAgent(id)
    if (result.ok) setAgents((current) => current.filter((agent) => agent.id !== id))
    else setError(result.error)
  }

  return (
    <div id="custom-agents" className="space-y-4">
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
      {agents.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="rounded-xl p-3"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {agent.name}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: `var(--assistant-${agent.theme ?? 'emerald'})` }}
                      aria-hidden
                    />
                    <p className="line-clamp-2 text-xs text-[var(--text-tertiary)]">
                      {agent.description || agent.systemPrompt}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  <button
                    type="button"
                    onClick={() => void remove(agent.id)}
                    className="text-xs text-red-500"
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-3">
                <EmbedGenerator agentId={agent.id} assistantName={agent.name} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <input
          aria-label="Assistant name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Assistant name"
          className="rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
        />
        <select
          aria-label="Assistant baseline model"
          value={baselineModel}
          onChange={(event) => setBaselineModel(event.target.value)}
          className="rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
        >
          <option value="">Provider default model</option>
          {MODEL_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <label className="block text-xs font-medium text-[var(--text-secondary)]">
        Visual theme
        <select
          aria-label="Assistant visual theme"
          value={theme}
          onChange={(event) => setTheme(event.target.value)}
          className="mt-1 w-full rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
        >
          {CustomAgentThemeSchema.options.map((option) => (
            <option key={option} value={option}>
              {option[0]!.toUpperCase() + option.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <fieldset
        className="rounded-xl p-3"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
      >
        <legend className="px-1 text-xs font-medium text-[var(--text-secondary)]">
          Assistant tools
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {ASSISTANT_TOOLS.map((tool) => (
            <label
              key={tool.id}
              className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"
            >
              <input
                type="checkbox"
                checked={selectedTools.includes(tool.id)}
                onChange={(event) =>
                  setSelectedTools((current) =>
                    event.target.checked
                      ? [...current, tool.id]
                      : current.filter((id) => id !== tool.id),
                  )
                }
              />
              {tool.label}
            </label>
          ))}
        </div>
      </fieldset>
      <textarea
        aria-label="Assistant system prompt"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder="Describe how this assistant should behave..."
        rows={4}
        className="w-full resize-y rounded-xl px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
        style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
      />
      <button
        type="button"
        disabled={!name.trim() || !prompt.trim() || saving}
        onClick={() => void create()}
        className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Create assistant'}
      </button>
    </div>
  )
}

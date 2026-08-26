'use client'

import Link from 'next/link'
import { ExternalLink, FileText, Play, Rocket, Terminal as TerminalIcon, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ChatMessage, UploadedDocument, WorkspaceTool } from '@/lib/types'
import FileUpload from './file-upload'
import Markdown from './markdown'

interface WorkspacePanelProps {
  tool: WorkspaceTool
  sessionId: string | null
  messages: ChatMessage[]
  documents: UploadedDocument[]
  onDocumentsChange: (documents: UploadedDocument[]) => void
  onSessionRequired: () => Promise<string | null>
  onNewChat: () => void
  onClose: () => void
}

const TERMINAL_HELP = [
  'help       Show available workspace commands',
  'new        Start a new chat',
  'settings   Open Settings',
  'dashboard  Open Usage & Analytics',
  'clear      Clear terminal output',
]

function TerminalPanel({ onNewChat }: { onNewChat: () => void }) {
  const router = useRouter()
  const [command, setCommand] = useState('')
  const [output, setOutput] = useState<string[]>([
    'Workspace terminal ready. Type help for commands.',
  ])

  function runCommand() {
    const value = command.trim().toLowerCase()
    if (!value) return
    setCommand('')

    if (value === 'clear') {
      setOutput([])
      return
    }
    if (value === 'help') {
      setOutput((current) => [...current, ...TERMINAL_HELP])
      return
    }
    if (value === 'new') {
      onNewChat()
      setOutput((current) => [...current, 'Started a new chat.'])
      return
    }
    if (value === 'settings' || value === 'dashboard') {
      const path = value === 'settings' ? '/settings' : '/dashboard'
      router.push(path)
      return
    }
    setOutput((current) => [...current, `Unknown command: ${value}. Type help.`])
  }

  return (
    <div className="space-y-3">
      <div
        className="min-h-32 max-h-48 overflow-y-auto rounded-lg p-3 font-mono text-xs leading-5"
        style={{ background: 'var(--bg-deep)', border: '1px solid var(--border-subtle)' }}
        aria-live="polite"
        data-testid="terminal-output"
      >
        {output.length === 0 ? (
          <span className="text-[var(--text-muted)]">Terminal cleared.</span>
        ) : (
          output.map((line, index) => (
            <div key={`${line}-${index}`} className="whitespace-pre-wrap text-emerald-300">
              {line}
            </div>
          ))
        )}
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          runCommand()
        }}
      >
        <label htmlFor="workspace-terminal-command" className="sr-only">
          Terminal command
        </label>
        <span className="font-mono text-xs text-emerald-500" aria-hidden="true">
          $
        </span>
        <input
          id="workspace-terminal-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Type a workspace command"
          className="min-w-0 flex-1 rounded-lg px-2.5 py-2 font-mono text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          style={{ background: 'var(--bg-input)', border: '1px solid var(--border-medium)' }}
        />
        <button
          type="submit"
          aria-label="Run command"
          title="Run command"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-slate-950 transition-colors hover:bg-emerald-400"
        >
          <Play size={14} fill="currentColor" aria-hidden="true" />
        </button>
      </form>
      <p className="text-[11px] text-[var(--text-tertiary)]">
        This console handles workspace navigation and chat actions; server-side shell execution is
        intentionally unavailable in the browser.
      </p>
    </div>
  )
}

function FilesPanel({
  sessionId,
  documents,
  onDocumentsChange,
  onSessionRequired,
}: Pick<
  WorkspacePanelProps,
  'sessionId' | 'documents' | 'onDocumentsChange' | 'onSessionRequired'
>) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <FileText size={16} className="mt-0.5 shrink-0 text-emerald-400" aria-hidden="true" />
        <div>
          <p className="text-sm text-[var(--text-primary)]">Session documents</p>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            Upload a document to ground replies in this conversation. Files are processed by the
            existing document API and remain scoped to the current session.
          </p>
        </div>
      </div>
      <FileUpload
        sessionId={sessionId}
        onSessionRequired={onSessionRequired}
        documents={documents}
        onDocumentsChange={onDocumentsChange}
      >
        <span className="text-xs text-[var(--text-tertiary)]">
          {sessionId ? 'Choose a document to upload' : 'Uploading will create a chat session'}
        </span>
      </FileUpload>
    </div>
  )
}

function PreviewPanel({
  messages,
  sessionId,
}: Pick<WorkspacePanelProps, 'messages' | 'sessionId'>) {
  const assistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Play size={15} className="text-emerald-400" aria-hidden="true" />
        <p className="text-sm text-[var(--text-primary)]">Latest assistant response</p>
      </div>
      <div
        className="max-h-64 overflow-y-auto rounded-lg p-3 text-sm"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
        data-testid="workspace-preview-content"
      >
        {assistantMessage?.content ? (
          <Markdown content={assistantMessage.content} sessionId={sessionId} />
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">
            No assistant response to preview yet.
          </p>
        )}
      </div>
    </div>
  )
}

function PublishPanel() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm text-[var(--text-primary)]">Publish an assistant</p>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          Create a private assistant and generate an embeddable widget from the dashboard.
        </p>
      </div>
      <Link
        href="/dashboard#custom-agents"
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
      >
        Open publishing workspace
        <ExternalLink size={13} aria-hidden="true" />
      </Link>
    </div>
  )
}

export default function WorkspacePanel({
  tool,
  sessionId,
  messages,
  documents,
  onDocumentsChange,
  onSessionRequired,
  onNewChat,
  onClose,
}: WorkspacePanelProps) {
  const title = tool[0]!.toUpperCase() + tool.slice(1)
  const ToolIcon = {
    terminal: TerminalIcon,
    files: FileText,
    preview: Play,
    publish: Rocket,
  }[tool]

  return (
    <section
      aria-label={`${title} workspace panel`}
      data-testid="workspace-panel"
      className="mx-4 mt-3 rounded-xl p-3 sm:p-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--accent-medium)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <ToolIcon size={15} className="shrink-0 text-emerald-400" aria-hidden="true" />
          <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Close ${title} workspace panel`}
          title={`Close ${title}`}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-input)] hover:text-[var(--text-primary)]"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      {tool === 'terminal' && <TerminalPanel onNewChat={onNewChat} />}
      {tool === 'files' && (
        <FilesPanel
          sessionId={sessionId}
          documents={documents}
          onDocumentsChange={onDocumentsChange}
          onSessionRequired={onSessionRequired}
        />
      )}
      {tool === 'preview' && <PreviewPanel messages={messages} sessionId={sessionId} />}
      {tool === 'publish' && <PublishPanel />}
    </section>
  )
}

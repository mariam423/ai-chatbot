'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { Mail01Icon, ArrowLeft01Icon, SentIcon } from '@hugeicons/core-free-icons'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { requestPasswordReset } from '@/app/actions/auth'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setLoading(true)
    try {
      const result = await requestPasswordReset({ email })
      if (!result.ok) {
        setError(result.error)
        if (result.issues) {
          const errs: Record<string, string> = {}
          for (const issue of result.issues) {
            if (issue.message.includes('email') || issue.message.includes('Email'))
              errs.email = issue.message
          }
          setFieldErrors(errs)
        }
        return
      }
      setSent(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4"
      style={{ backgroundColor: 'var(--bg-deep)' }}
    >
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute inset-0">
        <div className="ambient-glow absolute -left-32 -top-32 size-[520px] rounded-full bg-cyan-600/20 blur-[140px]" />
        <div className="ambient-glow-slow absolute -bottom-32 -right-32 size-[480px] rounded-full bg-indigo-500/15 blur-[130px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24, mass: 0.8 }}
        className="relative w-full max-w-[420px] rounded-3xl p-8"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(40px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
          border: '1px solid var(--glass-border)',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.03), 0 8px 40px rgba(0,0,0,0.1), 0 0 80px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        <AnimatePresence mode="wait">
          {sent ? (
            <motion.div
              key="sent"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="flex flex-col items-center py-6 text-center"
            >
              <div
                className="mb-5 flex size-14 items-center justify-center rounded-2xl"
                style={{
                  background: 'var(--accent-soft)',
                  border: '1px solid var(--accent-medium)',
                }}
              >
                <HugeiconsIcon
                  icon={SentIcon}
                  size={26}
                  strokeWidth={1.5}
                  className="text-cyan-400"
                />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                Check your inbox
              </h1>
              <p className="mt-2 max-w-[300px] text-sm leading-relaxed text-[var(--text-secondary)]">
                If an account exists for <span className="font-medium">{email}</span>, a reset link
                is on its way. The link expires in 1 hour.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSent(false)
                  setEmail('')
                }}
                className="mt-6 text-sm font-medium text-cyan-500 transition-colors hover:text-cyan-400"
              >
                Use a different email
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
            >
              <div className="mb-8 flex flex-col items-center">
                <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                  Forgot your password?
                </h1>
                <p className="mt-1.5 text-center text-sm text-[var(--text-secondary)]">
                  Enter your email and we&apos;ll send you a reset link
                </p>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-4 overflow-hidden rounded-xl px-3 py-2.5 text-sm"
                    style={{
                      background: 'var(--error-bg)',
                      border: '1px solid var(--error-border)',
                      color: 'var(--error-text)',
                    }}
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="floating-label-group">
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder=" "
                    required
                    autoComplete="email"
                    className={`focus-glow w-full rounded-xl py-3 pl-10 pr-3 text-sm text-[var(--text-primary)] outline-none ${
                      fieldErrors.email ? 'border-red-500/50' : ''
                    }`}
                    style={{
                      background: 'var(--bg-input)',
                      border: `1px solid ${fieldErrors.email ? 'rgba(239,68,68,0.5)' : 'var(--border-medium)'}`,
                    }}
                  />
                  <label htmlFor="email">
                    <HugeiconsIcon
                      icon={Mail01Icon}
                      size={14}
                      className="mr-1.5 inline text-[var(--text-muted)]"
                    />
                    Email address
                  </label>
                  {fieldErrors.email && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.email}</p>
                  )}
                </div>

                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={{ scale: 1.01, boxShadow: '0 0 28px rgba(6,182,212,0.3)' }}
                  whileTap={{ scale: 0.98 }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #0891B2 0%, #4F46E5 100%)',
                    boxShadow:
                      '0 4px 20px rgba(6,182,212,0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
                  }}
                >
                  {loading ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    'Send reset link'
                  )}
                </motion.button>
              </form>

              <div className="mt-6 text-center">
                <Link
                  href="/login"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.5} />
                  Back to sign in
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

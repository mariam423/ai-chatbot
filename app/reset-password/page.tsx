'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { LockIcon, ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { motion, AnimatePresence } from 'framer-motion'
import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { resetPassword } from '@/app/actions/auth'

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    if (password !== confirm) {
      setFieldErrors({ confirm: 'Passwords do not match' })
      return
    }
    const token = new URLSearchParams(window.location.search).get('token') ?? ''
    setLoading(true)
    try {
      const result = await resetPassword({ token, password })
      if (!result.ok) {
        setError(result.error)
        if (result.issues) {
          const errs: Record<string, string> = {}
          for (const issue of result.issues) {
            if (issue.message.includes('token')) errs.token = issue.message
            else if (issue.message.includes('Password') || issue.message.includes('password'))
              errs.password = issue.message
          }
          setFieldErrors(errs)
        }
        return
      }
      setDone(true)
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
      <div className="pointer-events-none absolute inset-0">
        <div className="ambient-glow absolute -left-32 -top-32 size-[520px] rounded-full bg-emerald-600/20 blur-[140px]" />
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
          {done ? (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center py-6 text-center"
            >
              <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                Password updated
              </h1>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                Your password has been changed. You can now sign in with the new one.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                style={{
                  background: 'linear-gradient(135deg, #10b981 0%, #0d9488 100%)',
                  boxShadow:
                    '0 4px 20px rgba(16,185,129,0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
                }}
              >
                Go to sign in
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
              </Link>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
              <div className="mb-8 flex flex-col items-center">
                <h1 className="text-xl font-bold tracking-tight text-[var(--text-primary)]">
                  Set a new password
                </h1>
                <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                  Choose a password you don&apos;t use elsewhere
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
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder=" "
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={`focus-glow w-full rounded-xl py-3 pl-10 pr-3 text-sm text-[var(--text-primary)] outline-none ${
                      fieldErrors.password ? 'border-red-500/50' : ''
                    }`}
                    style={{
                      background: 'var(--bg-input)',
                      border: `1px solid ${fieldErrors.password ? 'rgba(239,68,68,0.5)' : 'var(--border-medium)'}`,
                    }}
                  />
                  <label htmlFor="password">
                    <HugeiconsIcon
                      icon={LockIcon}
                      size={14}
                      className="mr-1.5 inline text-[var(--text-muted)]"
                    />
                    Min. 8 characters
                  </label>
                  {fieldErrors.password && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.password}</p>
                  )}
                  {fieldErrors.token && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.token}</p>
                  )}
                </div>

                <div className="floating-label-group">
                  <input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder=" "
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className={`focus-glow w-full rounded-xl py-3 pl-10 pr-3 text-sm text-[var(--text-primary)] outline-none ${
                      fieldErrors.confirm ? 'border-red-500/50' : ''
                    }`}
                    style={{
                      background: 'var(--bg-input)',
                      border: `1px solid ${fieldErrors.confirm ? 'rgba(239,68,68,0.5)' : 'var(--border-medium)'}`,
                    }}
                  />
                  <label htmlFor="confirm">
                    <HugeiconsIcon
                      icon={LockIcon}
                      size={14}
                      className="mr-1.5 inline text-[var(--text-muted)]"
                    />
                    Confirm password
                  </label>
                  {fieldErrors.confirm && (
                    <p className="mt-1 text-xs text-red-500">{fieldErrors.confirm}</p>
                  )}
                </div>

                <motion.button
                  type="submit"
                  disabled={loading}
                  whileHover={{ scale: 1.01, boxShadow: '0 0 28px rgba(16,185,129,0.35)' }}
                  whileTap={{ scale: 0.98 }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #10b981 0%, #0d9488 100%)',
                    boxShadow:
                      '0 4px 20px rgba(16,185,129,0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
                  }}
                >
                  {loading ? (
                    <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    'Reset password'
                  )}
                </motion.button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

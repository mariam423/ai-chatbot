'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Mail01Icon,
  LockIcon,
  UserIcon,
  ArrowRight01Icon,
  ViewIcon,
  ViewOffIcon,
  AiSparklesIcon,
} from '@hugeicons/core-free-icons'
import { motion, AnimatePresence } from 'framer-motion'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { useViewTransitionRouter } from '@/hooks/use-view-transition-router'
import { registerUser } from '@/app/actions/auth'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const router = useRouter()
  const { navigate } = useViewTransitionRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})
    setLoading(true)

    try {
      if (mode === 'signup') {
        const result = await registerUser({ name, email, password })
        if (!result.ok) {
          setError(result.error)
          if (result.issues) {
            const errs: Record<string, string> = {}
            for (const issue of result.issues) {
              if (issue.message.includes('Name')) errs.name = issue.message
              else if (issue.message.includes('email') || issue.message.includes('Email'))
                errs.email = issue.message
              else if (issue.message.includes('Password') || issue.message.includes('password'))
                errs.password = issue.message
            }
            setFieldErrors(errs)
          }
          setLoading(false)
          return
        }
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError(
          mode === 'login' ? 'Invalid email or password.' : 'Account created. Please sign in.',
        )
        if (mode === 'signup') setMode('login')
      } else {
        navigate('/')
        router.refresh()
      }
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
      {/* ─── Ambient background glows ─── */}
      <div className="pointer-events-none absolute inset-0 vt-ambient-bg">
        <div className="ambient-glow absolute -left-32 -top-32 size-[520px] rounded-full bg-emerald-600/20 blur-[140px]" />
        <div className="ambient-glow-slow absolute -bottom-32 -right-32 size-[480px] rounded-full bg-teal-500/15 blur-[130px]" />
        <div
          className="ambient-glow absolute left-1/2 top-1/2 size-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/10 blur-[110px]"
          style={{ animationDelay: '2s' }}
        />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(16,185,129,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.3) 1px, transparent 1px)',
            backgroundSize: '64px 64px',
          }}
        />
      </div>

      {/* ─── Glass card ─── */}
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 24, mass: 0.8 }}
        className="relative w-full max-w-[420px] rounded-3xl p-8 vt-login-card"
        style={{
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(40px) saturate(1.5)',
          WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
          border: '1px solid var(--glass-border)',
          boxShadow:
            '0 0 0 1px rgba(255,255,255,0.03), 0 8px 40px rgba(0,0,0,0.1), 0 0 80px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.06)',
        }}
      >
        {/* ─── Neon logo ─── */}
        <div className="mb-8 flex flex-col items-center">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.15 }}
            className="mb-5 relative vt-neon-logo"
          >
            {/* Glow behind logo */}
            <div className="absolute inset-0 -m-3 rounded-2xl bg-emerald-500/25 blur-xl" />
            <div
              className="relative flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700"
              style={{
                boxShadow:
                  '0 0 32px rgba(16,185,129,0.35), 0 4px 16px rgba(16,185,129,0.25), inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
            >
              <HugeiconsIcon
                icon={AiSparklesIcon}
                size={26}
                strokeWidth={1.5}
                className="text-white"
              />
            </div>
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.4 }}
            className="text-xl font-bold tracking-tight text-[var(--text-primary)]"
          >
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4 }}
            className="mt-1.5 text-sm text-[var(--text-secondary)]"
          >
            {mode === 'login'
              ? 'Sign in to continue to Chatbot'
              : 'Get started with your free account'}
          </motion.p>
        </div>

        {/* ─── SSO buttons ─── */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="mb-6 space-y-3"
        >
          <button
            type="button"
            onClick={() => signIn('github', { callbackUrl: '/' })}
            className="group flex w-full items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-all duration-200 hover:text-[var(--text-primary)]"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-medium)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-input-hover)'
              e.currentTarget.style.borderColor = 'var(--border-strong)'
              e.currentTarget.style.boxShadow = '0 0 20px var(--accent-glow)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-input)'
              e.currentTarget.style.borderColor = 'var(--border-medium)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Continue with GitHub
          </button>
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="flex w-full items-center justify-center gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-all duration-200 hover:text-[var(--text-primary)]"
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border-medium)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-input-hover)'
              e.currentTarget.style.borderColor = 'var(--border-strong)'
              e.currentTarget.style.boxShadow = '0 0 20px var(--accent-glow)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-input)'
              e.currentTarget.style.borderColor = 'var(--border-medium)'
              e.currentTarget.style.boxShadow = 'none'
            }}
          >
            <svg className="size-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            Continue with Google
          </button>
        </motion.div>

        {/* ─── Divider ─── */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full" style={{ borderTop: '1px solid var(--border-medium)' }} />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span
              className="px-3 text-[var(--text-tertiary)]"
              style={{ background: 'var(--glass-bg)' }}
            >
              or continue with email
            </span>
          </div>
        </div>

        {/* ─── Error ─── */}
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

        {/* ─── Form ─── */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <AnimatePresence mode="wait">
            {mode === 'signup' && (
              <motion.div
                key="name"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="floating-label-group">
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder=" "
                    autoComplete="name"
                    className={`focus-glow w-full rounded-xl py-3 pl-10 pr-3 text-sm text-[var(--text-primary)] outline-none ${
                      fieldErrors.name ? 'border-red-500/50' : ''
                    }`}
                    style={{
                      background: 'var(--bg-input)',
                      border: `1px solid ${fieldErrors.name ? 'rgba(239,68,68,0.5)' : 'var(--border-medium)'}`,
                    }}
                  />
                  <label htmlFor="name">
                    <HugeiconsIcon
                      icon={UserIcon}
                      size={14}
                      className="mr-1.5 inline text-[var(--text-muted)]"
                    />
                    Your name
                  </label>
                </div>
                {fieldErrors.name && (
                  <p className="mt-1 text-xs text-red-500">{fieldErrors.name}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

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
            {fieldErrors.email && <p className="mt-1 text-xs text-red-500">{fieldErrors.email}</p>}
          </div>

          <div className="floating-label-group">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=" "
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className={`focus-glow w-full rounded-xl py-3 pl-10 pr-10 text-sm text-[var(--text-primary)] outline-none ${
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
              {mode === 'login' ? 'Password' : 'Min. 8 characters'}
            </label>
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              <HugeiconsIcon
                icon={showPassword ? ViewOffIcon : ViewIcon}
                size={16}
                strokeWidth={1.5}
              />
            </button>
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-500">{fieldErrors.password}</p>
            )}
          </div>

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.01, boxShadow: '0 0 28px rgba(16,185,129,0.3)' }}
            whileTap={{ scale: 0.98 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all"
            style={{
              background: 'linear-gradient(135deg, #059669 0%, #0d9488 100%)',
              boxShadow: '0 4px 20px rgba(16,185,129,0.3), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}
          >
            {loading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                {mode === 'login' ? 'Sign in' : 'Create account'}
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={2} />
              </>
            )}
          </motion.button>
        </form>

        {/* ─── Toggle mode ─── */}
        <p className="mt-6 text-center text-sm text-[var(--text-secondary)]">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError(null)
              setFieldErrors({})
            }}
            className="font-medium text-emerald-500 transition-colors hover:text-emerald-400"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </motion.div>
    </div>
  )
}

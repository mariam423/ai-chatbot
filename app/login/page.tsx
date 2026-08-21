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
import { registerUser } from '@/app/actions/auth'

type Mode = 'login' | 'signup'

export default function LoginPage() {
  const router = useRouter()
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
        router.push('/')
        router.refresh()
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-zinc-950 px-4">
      {/* Ambient background gradients */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 size-[500px] rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 size-[500px] rounded-full bg-indigo-600/15 blur-[120px]" />
        <div className="absolute left-1/2 top-1/2 size-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-500/10 blur-[100px]" />
      </div>

      {/* Glass card */}
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[400px] rounded-2xl border border-white/[0.08] bg-white/[0.04] p-8 shadow-[0_0_60px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-2xl"
      >
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_4px_16px_rgba(124,58,237,0.4)]">
            <HugeiconsIcon
              icon={AiSparklesIcon}
              size={22}
              strokeWidth={1.5}
              className="text-white"
            />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {mode === 'login'
              ? 'Sign in to continue to Chatbot'
              : 'Get started with your free account'}
          </p>
        </div>

        {/* Social login buttons */}
        <div className="mb-6 space-y-3">
          <button
            type="button"
            onClick={() => signIn('github', { callbackUrl: '/' })}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-white/[0.14] hover:bg-white/[0.08]"
          >
            <svg className="size-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            Continue with GitHub
          </button>
          <button
            type="button"
            onClick={() => signIn('google', { callbackUrl: '/' })}
            className="flex w-full items-center justify-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-zinc-300 transition-all hover:border-white/[0.14] hover:bg-white/[0.08]"
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
        </div>

        {/* Divider */}
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/[0.08]" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-transparent px-3 text-zinc-500">or continue with email</span>
          </div>
        </div>

        {/* Error message */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 overflow-hidden rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
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
                <label htmlFor="name" className="sr-only">
                  Name
                </label>
                <div className="relative">
                  <HugeiconsIcon
                    icon={UserIcon}
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                  />
                  <input
                    id="name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Your name"
                    className={`w-full rounded-xl border bg-white/[0.04] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 ${
                      fieldErrors.name ? 'border-red-500/50' : 'border-white/[0.08]'
                    }`}
                  />
                </div>
                {fieldErrors.name && (
                  <p className="mt-1 text-xs text-red-400">{fieldErrors.name}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <div>
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <div className="relative">
              <HugeiconsIcon
                icon={Mail01Icon}
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className={`w-full rounded-xl border bg-white/[0.04] py-2.5 pl-10 pr-3 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 ${
                  fieldErrors.email ? 'border-red-500/50' : 'border-white/[0.08]'
                }`}
              />
            </div>
            {fieldErrors.email && <p className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
          </div>

          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <div className="relative">
              <HugeiconsIcon
                icon={LockIcon}
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              />
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'login' ? 'Your password' : 'Min. 8 characters'}
                required
                minLength={8}
                className={`w-full rounded-xl border bg-white/[0.04] py-2.5 pl-10 pr-10 text-sm text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 ${
                  fieldErrors.password ? 'border-red-500/50' : 'border-white/[0.08]'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 transition-colors hover:text-zinc-300"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <HugeiconsIcon
                  icon={showPassword ? ViewOffIcon : ViewIcon}
                  size={16}
                  strokeWidth={1.5}
                />
              </button>
            </div>
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-red-400">{fieldErrors.password}</p>
            )}
          </div>

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={{ scale: 1.01 }}
            whileTap={{ scale: 0.99 }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-violet-600 to-indigo-700 px-4 py-2.5 text-sm font-medium text-white shadow-[0_4px_16px_rgba(124,58,237,0.3),inset_0_1px_0_rgba(255,255,255,0.1)] transition-all hover:from-violet-500 hover:to-indigo-600 disabled:opacity-50"
          >
            {loading ? (
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <>
                {mode === 'login' ? 'Sign in' : 'Create account'}
                <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />
              </>
            )}
          </motion.button>
        </form>

        {/* Toggle mode */}
        <p className="mt-6 text-center text-sm text-zinc-400">
          {mode === 'login' ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'signup' : 'login')
              setError(null)
              setFieldErrors({})
            }}
            className="font-medium text-violet-400 transition-colors hover:text-violet-300"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </motion.div>
    </div>
  )
}

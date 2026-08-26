import { type DefaultSession } from 'next-auth'
import 'next-auth/jwt'
import type { UserRole } from '@/lib/roles'

type AppRole = UserRole
type AppPlan = 'free' | 'pro'

declare module 'next-auth' {
  interface User {
    role?: AppRole
    plan?: AppPlan
  }

  interface Session {
    user: {
      id: string
      role?: AppRole
      plan?: AppPlan
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string
    role?: AppRole
    plan?: AppPlan
  }
}

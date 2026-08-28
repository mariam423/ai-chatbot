import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/client'

/**
 * PrismaClient singleton. Each instance opens its own connection pool, so a
 * single instance is reused per process (Next dev hot-reloads included) to
 * avoid exhausting connections.
 *
 * The Postgres driver adapter talks to a hosted Postgres-compatible
 * database (Neon in production, local Postgres in dev). The `DATABASE_URL`
 * change is the only difference between environments — no schema changes
 * are needed at the application layer. Neon requires SSL, so the connection
 * string should include `?sslmode=require` (or `channel_binding=require`
 * with `sslmode=verify-full` for stricter setups).
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Configure it in .env.local (local dev) or ' +
      'in your hosting provider environment (Vercel → Project Settings ' +
      '→ Environment Variables) before starting the app.'
  )
}

const adapter = new PrismaPg({ connectionString })

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

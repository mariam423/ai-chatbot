import { PrismaLibSql } from '@prisma/adapter-libsql'
import { PrismaClient } from '../generated/client'

/**
 * PrismaClient singleton. Each instance opens its own connection pool, so a
 * single instance is reused per process (Next dev hot-reloads included) to
 * avoid exhausting connections.
 *
 * The LibSQL adapter runs SQLite locally via WASM (no native build tools
 * needed) and can point at a hosted LibSQL/Turso URL in production — the
 * `DATABASE_URL` change is the only difference.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
})

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

import { config } from 'dotenv'
import { defineConfig } from 'prisma/config'

// Load `.env` first (CI/deploy), then `.env.local` (local dev — the README's
// convention). dotenv never overwrites variables already in the process
// environment, so a DATABASE_URL exported by the shell or set in `.env`
// always wins. `quiet` keeps a fresh clone (neither file exists) from
// logging load noise.
config({ quiet: true })
config({ path: '.env.local', quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // `prisma generate` (the npm postinstall) must succeed without a
    // database — fall back to a placeholder Postgres URL so fresh clones
    // install cleanly. Runtime code (lib/db.ts) still requires a real
    // DATABASE_URL, and migrate/studio fail fast against the placeholder
    // because no local Postgres listens there.
    url: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pulse_ai',
  },
})

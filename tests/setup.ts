// Vitest setup file — runs before every test file's imports are evaluated.
//
// `lib/db.ts` throws at module load if `DATABASE_URL` is unset, and many
// unit tests transitively import `lib/auth` (which imports `lib/db`).
// Without a setup file, those tests would fail before their own
// `beforeAll` could set the env var.
//
// Tests that hit a real database (`tests/actions.test.ts`,
// `tests/auth-security.test.ts`) set their own `DATABASE_URL` in
// `beforeAll` and reset it in `afterAll`. Here we only set a default
// when one isn't already configured — the override from `beforeAll`
// always wins because it runs after this file.
//
// The placeholder URL is a valid Postgres-looking string; nothing in
// the importing modules actually opens a connection until a query is
// made, and the tests that touch the DB replace it before then.
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test'
}

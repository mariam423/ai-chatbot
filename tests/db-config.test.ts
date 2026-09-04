import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildPrismaPgConfig,
  isServerlessRuntime,
  parsePoolTuning,
  pooledUrlWarning,
} from '../lib/db-config'

afterEach(() => {
  vi.unstubAllEnvs()
})

/** A bare env object — never the real process.env — so defaults are deterministic. */
const EMPTY_ENV: Record<string, string | undefined> = {}

describe('isServerlessRuntime', () => {
  it('detects Vercel and AWS Lambda runtimes', () => {
    expect(isServerlessRuntime({ VERCEL: '1' })).toBe(true)
    expect(isServerlessRuntime({ VERCEL_ENV: 'production' })).toBe(true)
    expect(isServerlessRuntime({ AWS_LAMBDA_FUNCTION_NAME: 'pulse-api' })).toBe(true)
  })

  it('returns false for long-lived processes and bare envs', () => {
    expect(isServerlessRuntime(EMPTY_ENV)).toBe(false)
    expect(isServerlessRuntime({ NODE_ENV: 'production' })).toBe(false)
    expect(isServerlessRuntime({ VERCEL: '0' })).toBe(false)
  })

  it('defaults to the real process.env', () => {
    vi.stubEnv('VERCEL', '1')
    expect(isServerlessRuntime()).toBe(true)
  })
})

describe('parsePoolTuning', () => {
  it('defaults to node-postgres values on a long-lived process (no env = no change)', () => {
    expect(parsePoolTuning(EMPTY_ENV)).toEqual({
      max: 10,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 0,
    })
  })

  it('caps the pool at 1 connection per instance on a serverless runtime', () => {
    expect(parsePoolTuning({ VERCEL: '1' }).max).toBe(1)
    expect(parsePoolTuning({ VERCEL: '1' })).toEqual({
      max: 1,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 0,
    })
  })

  it('lets explicit env overrides beat the runtime default', () => {
    expect(
      parsePoolTuning({
        VERCEL: '1',
        DATABASE_POOL_MAX: '25',
        DATABASE_POOL_MIN: '2',
        DATABASE_POOL_IDLE_TIMEOUT_MS: '5000',
        DATABASE_POOL_CONNECTION_TIMEOUT_MS: '3000',
      }),
    ).toEqual({
      max: 25,
      min: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 3_000,
    })
  })

  it('falls back on invalid env values instead of throwing', () => {
    expect(
      parsePoolTuning({
        DATABASE_POOL_MAX: 'not-a-number',
        DATABASE_POOL_MIN: '-4',
        DATABASE_POOL_IDLE_TIMEOUT_MS: '2.5',
        DATABASE_POOL_CONNECTION_TIMEOUT_MS: '0',
      }),
    ).toEqual({
      max: 10,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 0,
    })
  })

  it('clamps min to max so a misconfigured pair cannot over-warm the pool', () => {
    expect(parsePoolTuning({ DATABASE_POOL_MAX: '5', DATABASE_POOL_MIN: '99' })).toEqual({
      max: 5,
      min: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 0,
    })
  })
})

describe('buildPrismaPgConfig', () => {
  it('passes the connection string through and spreads the tuning', () => {
    const config = buildPrismaPgConfig('postgresql://u:p@db.example/db', {
      DATABASE_POOL_MAX: '7',
    })
    expect(config).toEqual({
      connectionString: 'postgresql://u:p@db.example/db',
      max: 7,
      min: 0,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 0,
    })
  })
})

describe('pooledUrlWarning', () => {
  const NEON_DIRECT = 'postgresql://u:p@ep-abc.us-east-2.aws.neon.tech/db?sslmode=require'
  const NEON_POOLED =
    'postgresql://u:p@ep-abc.us-east-2.aws.neon.tech/db?sslmode=require&pgbouncer=true&connect_timeout=10'
  const LOCAL = 'postgresql://u:p@localhost:5432/db'

  it('is silent when the URL is not Neon-hosted or env is missing', () => {
    expect(pooledUrlWarning(LOCAL, { VERCEL: '1' })).toBeNull()
    expect(pooledUrlWarning(NEON_DIRECT, EMPTY_ENV)).toBeNull()
    expect(pooledUrlWarning(undefined, { VERCEL: '1' })).toBeNull()
  })

  it('warns on a Neon direct URL in a serverless runtime', () => {
    expect(pooledUrlWarning(NEON_DIRECT, { VERCEL: '1' })).toContain('pgbouncer=true')
  })

  it('is silent once the pooled URL is used', () => {
    expect(pooledUrlWarning(NEON_POOLED, { VERCEL: '1' })).toBeNull()
  })

  it('allows a Neon direct URL on long-lived processes (EC2 pool is process-local)', () => {
    expect(pooledUrlWarning(NEON_DIRECT, { NODE_ENV: 'production' })).toBeNull()
  })
})

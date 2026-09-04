declare module 'bullmq' {
  export interface JobOptions {
    removeOnComplete?: boolean | { age?: number; count?: number }
    removeOnFail?: boolean | { age?: number; count?: number }
    attempts?: number
    backoff?: {
      type: 'fixed' | 'exponential'
      delay: number
    }
    delay?: number
    priority?: number
    jobId?: string
    repeat?: {
      every?: number
      cron?: string
      limit?: number
    }
  }

  export interface Job<T = unknown> {
    id: string | undefined
    name: string
    data: T
    opts: JobOptions
    progress: unknown
    returnValue: unknown
    timestamp: number
    finishedOn?: number
    processedOn?: number
    failedReason?: string
  }

  export class Queue<T = unknown> {
    constructor(name: string, opts?: { connection?: unknown; defaultJobOptions?: JobOptions })
    add(name: string, data: T, opts?: JobOptions): Promise<Job<T>>
    getWaitingCount(): Promise<number>
    getActiveCount(): Promise<number>
    getCompletedCount(): Promise<number>
    getFailedCount(): Promise<number>
    getDelayedCount(): Promise<number>
    close(): Promise<void>
    obliterate(): Promise<void>
  }

  export interface WorkerOpts {
    connection?: unknown
    concurrency?: number
    limiter?: {
      max: number
      duration: number
    }
  }

  export class Worker<T = unknown> {
    constructor(
      name: string,
      processor: (job: Job<T>) => Promise<void>,
      opts?: WorkerOpts,
    )
    on(event: 'completed', listener: (job: Job<T>) => void): this
    on(event: 'failed', listener: (job: Job<T> | undefined, error: Error) => void): this
    on(event: 'error', listener: (error: Error) => void): this
    close(): Promise<void>
  }
}

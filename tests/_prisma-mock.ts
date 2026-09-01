// Minimal in-memory PrismaClient stub for unit tests that exercise server
// actions against the workspace tasks, chat sessions, custom agents, and
// user preferences tables. Real actions read/write these rows; the real
// Prisma client needs a live Postgres connection (or a file: SQLite that
// Prisma's AI guard refuses to provision for us). This stub mirrors only
// the operations exercised in tests/actions.test.ts — it is not a general
// Prisma mock and is not used outside that file.
//
// Each `model` is a key in `db` whose value is an array of records. The
// `where` filters are intentionally narrow (id / userId / unique column
// matches) and the `data` write is a shallow merge — enough for the
// action paths under test, not for production.

type Row = Record<string, unknown>

type Db = {
  user: Row[]
  userPreference: Row[]
  chatSession: Row[]
  chatMessage: Row[]
  customAgent: Row[]
  workspaceTask: Row[]
  passwordResetToken: Row[]
}

/**
 * Map of parent-model row → related-model table for `include` resolution.
 * Only the relations exercised by the actions under test are wired up.
 * Reading code uses `include: { messages: { orderBy: { position: 'asc' } } }`
 * on `chatSession` — the mock resolves the messages from the chatMessage
 * store and applies the requested orderBy.
 */
const RELATIONS: Record<string, { field: string; store: Row[] }> = {
  chatSession: { field: 'messages', store: [] }, // assigned in makeInMemoryPrisma
}

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  for (const [key, value] of Object.entries(where)) {
    // Prisma compound unique keys are passed as `{ a_b_c: { a, b, c } }`,
    // and so are compound where filters with `_and` / `_or`. Flatten the
    // inner key/value pairs and test each against the row.
    if (value && typeof value === 'object') {
      const obj = value as Row
      if ('in' in obj) {
        const list = (obj as { in: unknown[] }).in
        if (!list.includes(row[key])) return false
        continue
      }
      let allMatch = true
      for (const [subKey, subValue] of Object.entries(obj)) {
        if (row[subKey] !== subValue) {
          allMatch = false
          break
        }
      }
      if (!allMatch) return false
      continue
    }
    if (row[key] !== value) return false
  }
  return true
}

function applyInclude(row: Row, include: Record<string, unknown>, modelName: string): Row {
  const out: Row = { ...row }
  const relation = RELATIONS[modelName]
  if (!relation) return out
  const subOpts = include[relation.field] as { orderBy?: Row; where?: Row } | undefined
  if (!subOpts) return out
  const parentKey = modelName === 'chatSession' ? 'sessionId' : 'id'
  const children = relation.store.filter((child) => child[parentKey] === row['id'])
  if (subOpts.orderBy) {
    const [[key, dir]] = Object.entries(subOpts.orderBy) as [[string, 'asc' | 'desc']]
    children.sort((a, b) => {
      if (a[key] === b[key]) return 0
      const cmp = (a[key] as number) - (b[key] as number)
      return dir === 'asc' ? cmp : -cmp
    })
  }
  out[relation.field] = children
  return out
}

/**
 * Recursively inline a value from a Prisma.sql template into a SQL
 * string. Handles:
 *  - Prisma.empty / nested Prisma.sql templates (recurse into strings + values)
 *  - numbers (inlined bare)
 *  - strings (inlined verbatim — the action passes the formatted form)
 *  - everything else (stringified)
 */
function inlinePrismaValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object' && v !== null) {
    const obj = v as { strings?: unknown[]; values?: unknown[] }
    if (Array.isArray(obj.strings)) {
      let out = ''
      const strings = obj.strings
      const subValues = obj.values ?? []
      for (let i = 0; i < strings.length; i += 1) {
        out += String(strings[i] ?? '')
        if (i < subValues.length) out += inlinePrismaValue(subValues[i])
      }
      return out
    }
    return String(v)
  }
  if (typeof v === 'string') return v
  return String(v)
}

function buildModel(store: Row[], modelName: string) {
  return {
    async findUnique(
      { where, include }: { where: Row; include?: Record<string, unknown> } = { where: {} },
    ) {
      const row = store.find((r) => matchesWhere(r, where)) ?? null
      if (!row || !include) return row
      return applyInclude(row, include, modelName)
    },
    async findFirst({ where, include }: { where?: Row; include?: Record<string, unknown> } = {}) {
      const row = store.find((r) => matchesWhere(r, where)) ?? null
      if (!row || !include) return row
      return applyInclude(row, include, modelName)
    },
    async findMany({
      where,
      orderBy,
    }: { where?: Row; orderBy?: Row; include?: Record<string, unknown> } = {}) {
      const filtered = store.filter((row) => matchesWhere(row, where))
      if (orderBy && typeof orderBy === 'object') {
        const [[key, dir]] = Object.entries(orderBy) as [[string, 'asc' | 'desc']]
        filtered.sort((a, b) => {
          if (a[key] === b[key]) return 0
          const cmp = (a[key] as number) - (b[key] as number)
          return dir === 'asc' ? cmp : -cmp
        })
      }
      return [...filtered]
    },
    async findFirstOrdered({
      where,
      orderBy,
      include,
    }: {
      where?: Row
      orderBy?: Row
      include?: Record<string, unknown>
    } = {}) {
      // Convenience used by the chat-session list queries.
      const filtered = store.filter((row) => matchesWhere(row, where))
      if (orderBy) {
        const [[key, dir]] = Object.entries(orderBy) as [[string, 'asc' | 'desc']]
        filtered.sort((a, b) => {
          if (a[key] === b[key]) return 0
          const cmp = String(a[key]).localeCompare(String(b[key]))
          return dir === 'asc' ? cmp : -cmp
        })
      }
      const row = filtered[0] ?? null
      if (!row || !include) return row
      return applyInclude(row, include, modelName)
    },
    async create({ data }: { data: Row }) {
      // Prisma auto-generates a cuid id when the column has `@default(cuid())`
      // and the caller doesn't provide one. The mock mirrors that by
      // stamping a `cuid-` + random id when `data.id` is missing — the
      // server actions that read `session.id` afterwards depend on it.
      const row = {
        ...data,
        id: data.id ?? `cuid-${Math.random().toString(36).slice(2, 12)}`,
        updatedAt: data.updatedAt ?? new Date(),
      }
      store.push(row)
      return { ...row }
    },
    async createMany({ data }: { data: Row[] }) {
      const now = new Date()
      store.push(
        ...data.map((row) => ({
          ...row,
          id: row.id ?? `cuid-${Math.random().toString(36).slice(2, 12)}`,
          updatedAt: row.updatedAt ?? now,
        })),
      )
      return { count: data.length }
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const idx = store.findIndex((row) => matchesWhere(row, where))
      if (idx === -1) throw new Error('not found')
      store[idx] = { ...store[idx], ...data, updatedAt: new Date() }
      return { ...store[idx] }
    },
    async updateMany({ where, data }: { where?: Row; data: Row }) {
      let count = 0
      for (let i = 0; i < store.length; i += 1) {
        const row = store[i]
        if (!row) continue
        if (matchesWhere(row, where)) {
          store[i] = { ...store[i], ...data, updatedAt: new Date() }
          count += 1
        }
      }
      return { count }
    },
    async upsert({ where, update, create }: { where: Row; update: Row; create: Row }) {
      const idx = store.findIndex((row) => matchesWhere(row, where))
      const now = new Date()
      if (idx === -1) {
        const row = { ...create, updatedAt: create.updatedAt ?? now }
        store.push(row)
        return { ...row }
      }
      store[idx] = { ...store[idx], ...update, updatedAt: new Date() }
      return { ...store[idx] }
    },
    async delete({ where }: { where: Row }) {
      const idx = store.findIndex((row) => matchesWhere(row, where))
      if (idx === -1) throw new Error('not found')
      const [removed] = store.splice(idx, 1)
      return { ...removed }
    },
    async deleteMany({ where }: { where?: Row } = {}) {
      const keep: Row[] = []
      let count = 0
      for (const row of store) {
        if (matchesWhere(row, where)) {
          count += 1
        } else {
          keep.push(row)
        }
      }
      store.length = 0
      store.push(...keep)
      return { count }
    },
    async count({ where }: { where?: Row } = {}) {
      return store.filter((row) => matchesWhere(row, where)).length
    },
  }
}

/**
 * Build a fresh in-memory PrismaClient-shaped object covering the models
 * exercised by tests/actions.test.ts. Each call returns a new object so
 * tests can reset state with `vi.resetModules()` + a fresh import.
 */
export function makeInMemoryPrisma() {
  const db: Db = {
    user: [],
    userPreference: [],
    chatSession: [],
    chatMessage: [],
    customAgent: [],
    workspaceTask: [],
    passwordResetToken: [],
  }
  RELATIONS.chatSession = { field: 'messages', store: db.chatMessage }
  const models = {
    user: buildModel(db.user, 'user'),
    userPreference: buildModel(db.userPreference, 'userPreference'),
    chatSession: buildModel(db.chatSession, 'chatSession'),
    chatMessage: buildModel(db.chatMessage, 'chatMessage'),
    customAgent: buildModel(db.customAgent, 'customAgent'),
    workspaceTask: buildModel(db.workspaceTask, 'workspaceTask'),
    passwordResetToken: buildModel(db.passwordResetToken, 'passwordResetToken'),
  }
  return {
    prisma: {
      ...models,
      // `$transaction` is awaited with an array of pending operations in
      // app/actions.ts (chat-message save). Run them in order and return
      // the array of results — that's the shape Prisma returns for a
      // sequential transaction.
      async $transaction(ops: Promise<unknown>[]) {
        const out: unknown[] = []
        for (const op of ops) out.push(await op)
        return out
      },
      // The session-listing server action (`listChatSessions`) uses a
      // raw SQL query for the multi-row aggregation. Implementing a SQL
      // parser is overkill for unit tests, so we recognise that one
      // specific template (it has the `cs.id, cs.title` projection) and
      // synthesize the same result shape from the in-memory stores.
      // Anything else returns an empty array.
      async $queryRaw(...args: unknown[]) {
        // Prisma.sql`...` interpolates `${...}` values into the string
        // fragments in this codebase (the call site uses the values
        // directly, not parameterized placeholders). So the first arg is
        // an array of all strings with the values already inlined —
        // e.g. `["SELECT ...", "LIMIT 3 OFFSET 0"]`. We pull the LIMIT
        // and OFFSET numerics out of the fragments, and the search /
        // userId values from the inlined SQL.
        const fragments: string[] = []
        const values: unknown[] = []
        const first = args[0]
        if (Array.isArray(first)) {
          for (let i = 0; i < first.length; i += 1) {
            const v = first[i]
            if (typeof v === 'string') {
              fragments.push(v)
            } else {
              values.push(v)
            }
          }
        } else if (first && typeof first === 'object') {
          const obj = first as { strings?: unknown[]; values?: unknown[] }
          if (Array.isArray(obj.strings)) {
            for (const s of obj.strings) {
              if (typeof s === 'string') fragments.push(s)
            }
          }
          if (Array.isArray(obj.values)) values.push(...obj.values)
        }
        // The action calls `$queryRaw<...>(Prisma.sql\`...\`)` — a single
        // arg. But the older codepath passes values as trailing args after
        // the SQL array. Accept either shape.
        if (values.length === 0) {
          for (let i = 1; i < args.length; i += 1) {
            values.push(args[i])
          }
        }
        if (Array.isArray(first)) {
          // eslint-disable-next-line no-console
          console.log(
            '[mock] joined all fragments length:',
            first.map((s) => String(s)).join('').length,
          )
        }
        // Rebuild a SQL-shaped string by concatenating all fragments.
        // The action inlines `${take + 1}` etc. into the SQL strings,
        // so this join is the actual SQL minus the untyped numeric
        // interpolation (which we re-add by joining the literal strings
        // — they already include the numbers when Prisma.sql inlines).
        // Rebuild the SQL by interleaving fragments and values. The
        // action uses `Prisma.sql` so the values are passed as the
        // interpolated arguments; the SQL fragments alternate with
        // them in the array, so we splice values back in at `?`-like
        // positions to recover the full SQL.
        let raw = ''
        for (let i = 0; i < fragments.length; i += 1) {
          raw += fragments[i]
          if (i < values.length) {
            raw += inlinePrismaValue(values[i])
          }
        }
        if (!raw.includes('cs.id, cs.title')) return [] as unknown[]
        return synthesizeSessionList(db, raw)
      },
    },
    // Reset all in-memory stores back to empty. Call between tests so
    // rows from a prior `it` don't leak into the next assertion.
    reset() {
      for (const key of Object.keys(db) as (keyof Db)[]) {
        db[key].length = 0
      }
    },
  }
}

/**
 * Synthesize the same row shape `listChatSessions` expects from its
 * `$queryRaw<...>` result, computed from the in-memory chatSession +
 * chatMessage stores.
 *
 * The action inlines `${take + 1}` and `${skip}` into the SQL strings
 * via `Prisma.sql`, so the rejoin above carries them as literal numbers
 * inside the LIMIT/OFFSET pair. The userId (if any) and the search
 * term (if any) are also inlined — we pull them out of the rejoin.
 */
function synthesizeSessionList(db: Db, raw: string): Row[] {
  const sessions = db.chatSession
  const messages = db.chatMessage
  const limitMatch = raw.match(/LIMIT\s+(\d+)\s+OFFSET\s+(\d+)/i)
  const takePlusOne = limitMatch ? Number(limitMatch[1]) : 20
  const offset = limitMatch ? Number(limitMatch[2]) : 0
  const archived = raw.includes('cs.archived = 1')
  const userIdMatch = raw.match(/cs\.userId\s*=\s*(?:'([^']*)'|(\S+?))(?:\s|$)/)
  const userId = userIdMatch ? (userIdMatch[1] ?? userIdMatch[2]) : null
  // The inlined search term is the value passed to Prisma.sql — `%term%`
  // for the title clause and `%term%` for the content clause, with or
  // without surrounding single quotes. Match the first LIKE clause and
  // strip the surrounding `%` to get the actual search term.
  const searchMatch = raw.match(/LIKE\s+(?:'%)?(%?[^%]*?%?)(?:')?\s+COLLATE\s+NOCASE/s)
  const searchTerm = searchMatch?.[1] ? searchMatch[1].replace(/%/g, '').toLowerCase() : ''
  // eslint-disable-next-line no-console
  console.log('[mock] searchMatch:', searchMatch?.[0], '| searchTerm:', searchTerm)
  const filtered = sessions
    .filter((cs) => Boolean(cs.archived) === archived)
    .filter((cs) => messages.some((m) => m.sessionId === cs.id))
    .filter((cs) => !userIdMatch || cs.userId === userId)
    .filter((cs) => {
      if (!searchTerm) return true
      if (typeof cs.title === 'string' && cs.title.toLowerCase().includes(searchTerm)) return true
      return messages.some(
        (m) =>
          m.sessionId === cs.id &&
          typeof m.content === 'string' &&
          m.content.toLowerCase().includes(searchTerm),
      )
    })
  // eslint-disable-next-line no-console
  if (searchTerm) {
    // eslint-disable-next-line no-console
    console.log(
      '[mock] search term:',
      searchTerm,
      '| matched:',
      filtered.map((cs) => ({ id: cs.id, title: cs.title })),
    )
  }
  const sorted = [...filtered].sort((a, b) => {
    const ap = Boolean(a.pinned) ? 1 : 0
    const bp = Boolean(b.pinned) ? 1 : 0
    if (ap !== bp) return bp - ap
    // updatedAt is set by the mock on every upsert with `new Date()`. If
    // the timestamps tie (concurrent saves in the same tick), fall back
    // to the row's insertion order so the result is deterministic.
    const at = new Date(String(a.updatedAt ?? 0)).getTime()
    const bt = new Date(String(b.updatedAt ?? 0)).getTime()
    if (at !== bt) return bt - at
    return filtered.indexOf(b) - filtered.indexOf(a)
  })
  return sorted.slice(offset, offset + takePlusOne).map((cs) => {
    const sessionMessages = messages.filter((m) => m.sessionId === cs.id)
    const first = [...sessionMessages].sort(
      (a, b) => Number(a.position ?? 0) - Number(b.position ?? 0),
    )[0]
    const lastAssistant = [...sessionMessages]
      .filter((m) => m.role === 'assistant' && m.model != null)
      .sort((a, b) => Number(b.position ?? 0) - Number(a.position ?? 0))[0]
    return {
      id: cs.id,
      title: cs.title ?? null,
      first_content: first?.content ?? null,
      message_count: sessionMessages.length,
      updated_at: cs.updatedAt ?? new Date().toISOString(),
      pinned: cs.pinned ?? false,
      archived: cs.archived ?? false,
      last_model: lastAssistant?.model ?? null,
    }
  })
}

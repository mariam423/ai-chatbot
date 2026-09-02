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
  document: Row[]
  documentChunk: Row[]
}

/**
 * Map of parent-model row → related-model table for `include` resolution.
 * Only the relations exercised by the actions under test are wired up.
 * Reading code uses `include: { messages: { orderBy: { position: 'asc' } } }`
 * on `chatSession` — the mock resolves the messages from the chatMessage
 * store and applies the requested orderBy.
 */
// Relations the mock can resolve. Each entry names the *parent* model
// (chatSession / document) plus the child-side field name (messages /
// chunks). Two stores per relation so the mock can answer both
// directions:
//   - `parent`  — the parent rows (used for nested-where filtering:
//     "chunks whose document matches { sessionId }").
//   - `children` — the child rows (used to populate `include` lookups
//     and to set the foreign key on a nested create).
// `childKey` is the foreign key on the child side (e.g. documentId).
const RELATIONS: Record<string, { field: string; parent: Row[]; children: Row[]; childKey: string }> = {
  chatSession: { field: 'messages', parent: [], children: [], childKey: 'sessionId' },
  document: { field: 'chunks', parent: [], children: [], childKey: 'documentId' },
}

function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true
  for (const [key, value] of Object.entries(where)) {
    // Nested relation filter: `where: { document: { sessionId: 'x' } }` on
    // documentChunk.findMany means "chunks whose related document matches".
    // The relation here is keyed by parent name (document), so we look
    // it up directly and resolve the parent row from the *parent* store.
    if (key in RELATIONS && value && typeof value === 'object' && !Array.isArray(value)) {
      const relation = RELATIONS[key]!
      const parentId = row[relation.childKey]
      const parent = relation.parent.find((p) => p['id'] === parentId)
      if (!parent) return false
      if (!matchesWhere(parent, value as Row)) return false
      continue
    }
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

function applyInclude(row: Row, include: Record<string, unknown>): Row {
  const out: Row = { ...row }
  // An include entry may be keyed by the parent name (chatSession include
  // uses "messages" — that key matches RELATIONS.chatSession.field), or by
  // the parent name directly when the include is on the child side
  // (e.g. documentChunk.findMany with where: { document: ... }). For
  // `include` specifically, the key is always the child-field name, so we
  // find the relation whose `field` matches the include key.
  for (const [relationName, subOpts] of Object.entries(include)) {
    if (!subOpts) continue
    const relation = Object.values(RELATIONS).find((r) => r.field === relationName)
    if (!relation) continue
    const opts = subOpts as { orderBy?: Row; where?: Row }
    const children = relation.children.filter((child) => child[relation.childKey] === row['id'])
    let ordered = children
    if (opts.orderBy) {
      const [[key, dir]] = Object.entries(opts.orderBy) as [[string, 'asc' | 'desc']]
      ordered = [...children].sort((a, b) => {
        if (a[key] === b[key]) return 0
        const cmp = (a[key] as number) - (b[key] as number)
        return dir === 'asc' ? cmp : -cmp
      })
    }
    out[relation.field] = ordered
  }
  return out
}

/**
 * Prisma `select` projection. A value of `true` means "keep this column";
 * a nested object means "keep these sub-columns on the related record".
 * The mock only implements the shape used by RAG + upload (`{ chunkIndex,
 * content, embedding, document: { name } }`).
 */
function applySelect(row: Row | null, select: Record<string, unknown> | undefined): Row | null {
  if (!row) return row
  if (!select) return row
  const out: Row = {}
  for (const [key, value] of Object.entries(select)) {
    if (value === true) {
      out[key] = row[key]
    } else if (value && typeof value === 'object') {
      // Nested select on a relation. The key may be the parent name
      // (`document`) or the child-field name (`chunks`) — Prisma's
      // wire format for a nested select is
      // `{ document: { select: { name: true } } }` (parent name wraps
      // a `select` sub-key). Look up the relation either way.
      const relation =
        (RELATIONS[key] ?? Object.values(RELATIONS).find((r) => r.field === key))
      if (relation) {
        const parentId = row[relation.childKey]
        const related = relation.parent.find((p) => p['id'] === parentId)
        if (related) {
          const subValue = value as Record<string, unknown>
          const subSelect = ('select' in subValue
            ? (subValue.select as Record<string, unknown>)
            : subValue) as Record<string, unknown>
          out[key] = applySelect(related, subSelect)
        } else {
          out[key] = null
        }
      }
    }
  }
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

function buildModel(store: Row[]) {
  return {
    async findUnique(
      {
        where,
        include,
        select,
      }: {
        where: Row
        include?: Record<string, unknown>
        select?: Record<string, unknown>
      } = { where: {} },
    ) {
      const row = store.find((r) => matchesWhere(r, where)) ?? null
      if (!row) return row
      const withIncludes = include ? applyInclude(row, include) : row
      return applySelect(withIncludes, select)
    },
    async findFirst({
      where,
      include,
      select,
    }: {
      where?: Row
      include?: Record<string, unknown>
      select?: Record<string, unknown>
    } = {}) {
      const row = store.find((r) => matchesWhere(r, where)) ?? null
      if (!row) return row
      const withIncludes = include ? applyInclude(row, include) : row
      return applySelect(withIncludes, select)
    },
    async findMany({
      where,
      orderBy,
      include,
      select,
    }: {
      where?: Row
      orderBy?: Row
      include?: Record<string, unknown>
      select?: Record<string, unknown>
    } = {}) {
      const filtered = store.filter((row) => matchesWhere(row, where))
      if (orderBy && typeof orderBy === 'object') {
        const [[key, dir]] = Object.entries(orderBy) as [[string, 'asc' | 'desc']]
        filtered.sort((a, b) => {
          if (a[key] === b[key]) return 0
          const cmp = (a[key] as number) - (b[key] as number)
          return dir === 'asc' ? cmp : -cmp
        })
      }
      return filtered.map((row) => {
        const withIncludes = include ? applyInclude(row, include) : row
        return applySelect(withIncludes, select)
      })
    },
    async findFirstOrdered({
      where,
      orderBy,
      include,
      select,
    }: {
      where?: Row
      orderBy?: Row
      include?: Record<string, unknown>
      select?: Record<string, unknown>
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
      if (!row) return row
      const withIncludes = include ? applyInclude(row, include) : row
      return applySelect(withIncludes, select)
    },
    async create({ data }: { data: Row }) {
      // Prisma auto-generates a cuid id when the column has `@default(cuid())`
      // and the caller doesn't provide one. The mock mirrors that by
      // stamping a `cuid-` + random id when `data.id` is missing — the
      // server actions that read `session.id` afterwards depend on it.
      //
      // Nested writes (`chunks: { create: [...] }`) are flattened into
      // child rows that reference the parent's id via the relation's
      // child foreign key. Only the one-relation-deep shape used by the
      // upload route (document → documentChunk) is supported; deeper
      // nesting isn't currently exercised by the tests.
      const { ...topData } = data
      const nested: Array<{ relation: string; rows: Row[] }> = []
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && 'create' in (value as Row)) {
          const childRows = (value as { create: Row[] }).create
          if (Array.isArray(childRows)) {
            nested.push({ relation: key, rows: childRows })
            delete (topData as Row)[key]
          }
        }
      }
      const row = {
        ...topData,
        id: (topData as Row).id ?? `cuid-${Math.random().toString(36).slice(2, 12)}`,
        updatedAt: (topData as Row).updatedAt ?? new Date(),
      }
      store.push(row)
      for (const { relation, rows } of nested) {
        // The nested write key is the *child* field name (chunks/messages),
        // so find the relation whose `field` matches the key.
        const rel = Object.values(RELATIONS).find((r) => r.field === relation)
        if (!rel) continue
        for (const child of rows) {
          rel.children.push({
            ...child,
            id: child.id ?? `cuid-${Math.random().toString(36).slice(2, 12)}`,
            [rel.childKey]: row.id,
            createdAt: child.createdAt ?? new Date(),
          })
        }
      }
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
    document: [],
    documentChunk: [],
  }
  // The Record<string, ...> index access yields `T | undefined` under
  // strict TS, so grab the entries once and assert the shape we just
  // declared at module load.
  const chatSessionRel = RELATIONS.chatSession!
  const documentRel = RELATIONS.document!
  chatSessionRel.parent = db.chatSession
  chatSessionRel.children = db.chatMessage
  documentRel.parent = db.document
  documentRel.children = db.documentChunk
  const models = {
    user: buildModel(db.user),
    userPreference: buildModel(db.userPreference),
    chatSession: buildModel(db.chatSession),
    chatMessage: buildModel(db.chatMessage),
    customAgent: buildModel(db.customAgent),
    workspaceTask: buildModel(db.workspaceTask),
    passwordResetToken: buildModel(db.passwordResetToken),
    document: buildModel(db.document),
    documentChunk: buildModel(db.documentChunk),
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

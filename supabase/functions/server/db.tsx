import * as kv from './kv-adapter.tsx'
import * as tables from './table-adapter.tsx'
import { SCHEMA, coerceNull, columnOf, type TableSpec } from './schema.tsx'

/**
 * Document store over the dw_* Postgres tables. Code works with Payload-shaped documents (same
 * ids, camelCase fields, groups as objects, relationships as ids); this module maps them to the
 * snake_case columns defined in schema.tsx and back.
 */
export type Doc = { id: string; createdAt: string; updatedAt: string; [k: string]: unknown }

export const COLLECTIONS = Object.keys(SCHEMA)

export class UniqueViolation extends Error {
  constructor(public collection: string, public field: string) {
    super(`unique:${collection}.${field}`)
  }
}

/** Business-rule failure with a stable machine code, turned into `{ ok:false, error }` by routes. */
export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public extra: { field?: string; params?: Record<string, string | number> } = {},
  ) {
    super(code)
  }
}

export const nowISO = () => new Date().toISOString()
export const newId = () => crypto.randomUUID()

export function idOf(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'object' && 'id' in (value as object)) return String((value as { id: unknown }).id)
  return null
}

function spec(col: string): TableSpec {
  const s = SCHEMA[col]
  if (!s) throw new Error(`unknown collection ${col}`)
  return s
}

const isUuid = (type: string) => /^uuid\b/.test(type)
const isUuidArray = (type: string) => /^uuid\[\]/.test(type)

function toRow(col: string, doc: Record<string, unknown>) {
  const s = spec(col)
  const row: Record<string, unknown> = { id: doc.id }
  for (const c of s.columns) {
    const [field, type] = c
    if (!(field in doc)) continue
    let v = doc[field]
    if (isUuidArray(type)) v = Array.isArray(v) ? v.map(idOf).filter(Boolean) : []
    else if (isUuid(type)) v = idOf(v)
    row[columnOf(c)] = coerceNull(type, v)
  }
  if (doc.createdAt) row.created_at = doc.createdAt
  if (doc.updatedAt) row.updated_at = doc.updatedAt
  return row
}

function toDoc<T>(col: string, row: Record<string, unknown> | null): T | null {
  if (!row) return null
  const s = spec(col)
  const doc: Record<string, unknown> = { id: row.id }
  for (const c of s.columns) doc[c[0]] = row[columnOf(c)] ?? null
  doc.createdAt = row.created_at
  doc.updatedAt = row.updated_at
  return doc as T
}

function uniqueError(col: string, err: tables.DbUniqueError) {
  const s = spec(col)
  const hit = (s.unique ?? []).find((f) => {
    const c = s.columns.find((x) => x[0] === f)!
    return err.constraint === `${s.table}_${columnOf(c)}_key`
  })
  return new UniqueViolation(col, hit ?? (err.constraint.endsWith('_pkey') ? 'id' : 'unique'))
}

async function guard<T>(col: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof tables.DbUniqueError) throw uniqueError(col, err)
    throw err
  }
}

export async function getDoc<T = Doc>(col: string, id: string | null | undefined): Promise<T | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return toDoc<T>(col, await tables.selectById(spec(col).table, id))
}

export async function getDocs<T = Doc>(col: string, ids: (string | null | undefined)[]): Promise<T[]> {
  const list = [...new Set(ids.filter((x): x is string => Boolean(x) && /^[0-9a-f-]{36}$/i.test(x as string)))]
  if (list.length === 0) return []
  const rows = await tables.selectByIds(spec(col).table, list)
  const byId = new Map(rows.map((r) => [String(r.id), r]))
  return list.map((id) => toDoc<T>(col, byId.get(id) ?? null)).filter(Boolean) as T[]
}

/** Documents whose `field` equals `value` (array fields: contain it). */
export async function find<T = Doc>(col: string, field: string, value: string | null | undefined): Promise<T[]> {
  if (!value) return []
  const s = spec(col)
  const c = s.columns.find((x) => x[0] === field)
  if (!c) throw new Error(`unknown field ${col}.${field}`)
  if ((isUuid(c[1]) || isUuidArray(c[1])) && !/^[0-9a-f-]{36}$/i.test(value)) return []
  const rows = await tables.selectWhere(s.table, columnOf(c), value, { array: c[1].includes('[]') })
  return rows.map((r) => toDoc<T>(col, r)!) as T[]
}

export async function findOne<T = Doc>(col: string, field: string, value: string | null | undefined): Promise<T | null> {
  return (await find<T>(col, field, value))[0] ?? null
}

export async function allDocs<T = Doc>(col: string): Promise<T[]> {
  return (await tables.selectAll(spec(col).table)).map((r) => toDoc<T>(col, r)!) as T[]
}

/** Writes a whole document (insert or replace). `prev` is accepted for call-site symmetry. */
export async function saveDoc<T extends Record<string, unknown>>(col: string, doc: T, _prev?: Record<string, unknown> | null): Promise<T & Doc> {
  if (!doc.id) throw new Error('saveDoc needs an id')
  const row = toRow(col, { ...doc, updatedAt: nowISO() })
  const saved = await guard(col, () => tables.upsertRow(spec(col).table, row))
  return { ...doc, ...toDoc<Doc>(col, saved)! } as T & Doc
}

export async function createDoc<T extends Record<string, unknown>>(col: string, data: T): Promise<T & Doc> {
  const now = nowISO()
  const row = toRow(col, { ...data, id: (data.id as string) ?? newId(), createdAt: (data.createdAt as string) ?? now, updatedAt: (data.updatedAt as string) ?? now })
  const saved = await guard(col, () => tables.insertRow(spec(col).table, row))
  return { ...data, ...toDoc<Doc>(col, saved)! } as T & Doc
}

export async function deleteDoc(col: string, id: string) {
  const prev = await getDoc<Doc>(col, id)
  if (!prev) return null
  await tables.deleteRow(spec(col).table, id)
  return prev
}

export async function pruneBefore(col: string, field: string, beforeIso: string) {
  const s = spec(col)
  const c = s.columns.find((x) => x[0] === field)!
  await tables.deleteWhereBefore(s.table, columnOf(c), beforeIso)
}

export async function getGlobal<T = Record<string, unknown>>(slug: string): Promise<T> {
  return ((await tables.getGlobalRow(slug)) as T | null) ?? ({} as T)
}

export async function setGlobal(slug: string, value: Record<string, unknown>) {
  const { id: _id, globalType: _g, createdAt: _c, updatedAt: _u, ...data } = value
  await tables.setGlobalRow(slug, data)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Mutual exclusion across function instances. The lock row is created with an atomic insert;
 * a holder that died is taken over after its TTL. Throws `busy` if it cannot get the lock.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
  const key = `lock:${name}`
  const ttl = opts.ttlMs ?? 15_000
  const deadline = Date.now() + (opts.waitMs ?? 8_000)
  const token = { owner: newId(), exp: 0 }
  while (true) {
    token.exp = Date.now() + ttl
    if (await kv.insert(key, token)) break
    const held = (await kv.get(key)) as { owner?: string; exp?: number } | undefined
    if (held && (held.exp ?? 0) < Date.now()) {
      await kv.delIf(key, held)
      continue
    }
    if (!held) continue
    if (Date.now() > deadline) throw new DomainError('busy', 409)
    await sleep(40 + Math.random() * 120)
  }
  try {
    return await fn()
  } finally {
    await kv.delIf(key, token)
  }
}

/** Short-lived key/value data (sessions, OTPs, idempotency, rate limits) in dw_kv. */
export const raw = kv

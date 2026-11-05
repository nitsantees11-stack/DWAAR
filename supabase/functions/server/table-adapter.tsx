import { db } from './kv-adapter.tsx'

/**
 * Row access to the dw_* tables through PostgREST (service role, so RLS does not apply).
 * Tests swap this module for an in-memory one that enforces the same unique constraints.
 */
export type Row = Record<string, unknown>

export class DbUniqueError extends Error {
  constructor(public constraint: string) {
    super(`unique violation: ${constraint}`)
  }
}

function fail(error: { code?: string; message: string }): never {
  if (error.code === '23505') {
    const constraint = /constraint "([^"]+)"/.exec(error.message)?.[1] ?? 'unknown'
    throw new DbUniqueError(constraint)
  }
  throw new Error(error.message)
}

export async function selectById(table: string, id: string): Promise<Row | null> {
  const { data, error } = await db().from(table).select('*').eq('id', id).maybeSingle()
  if (error) fail(error)
  return (data as Row) ?? null
}

export async function selectByIds(table: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db().from(table).select('*').in('id', ids.slice(i, i + 150))
    if (error) fail(error)
    out.push(...((data as Row[]) ?? []))
  }
  return out
}

/** Rows where `column` equals `value` (or, for array columns, contains it). */
export async function selectWhere(table: string, column: string, value: string, opts: { array?: boolean } = {}): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const q = db().from(table).select('*')
    const { data, error } = await (opts.array ? q.contains(column, [value]) : q.eq(column, value)).order('created_at').range(from, from + 999)
    if (error) fail(error)
    out.push(...((data as Row[]) ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function selectAll(table: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db().from(table).select('*').order('created_at').range(from, from + 999)
    if (error) fail(error)
    out.push(...((data as Row[]) ?? []))
    if (!data || data.length < 1000) return out
  }
}

export async function insertRow(table: string, row: Row): Promise<Row> {
  const { data, error } = await db().from(table).insert(row).select('*').single()
  if (error) fail(error)
  return data as Row
}

export async function upsertRow(table: string, row: Row): Promise<Row> {
  const { data, error } = await db().from(table).upsert(row, { onConflict: 'id' }).select('*').single()
  if (error) fail(error)
  return data as Row
}

export async function deleteRow(table: string, id: string): Promise<void> {
  const { error } = await db().from(table).delete().eq('id', id)
  if (error) fail(error)
}

export async function deleteWhereBefore(table: string, column: string, beforeIso: string): Promise<void> {
  const { error } = await db().from(table).delete().lt(column, beforeIso)
  if (error) fail(error)
}

export async function getGlobalRow(slug: string): Promise<Row | null> {
  const { data, error } = await db().from('dw_globals').select('data').eq('slug', slug).maybeSingle()
  if (error) fail(error)
  return ((data as { data?: Row } | null)?.data as Row) ?? null
}

export async function setGlobalRow(slug: string, value: Row): Promise<void> {
  const { error } = await db().from('dw_globals').upsert({ slug, data: value, updated_at: new Date().toISOString() })
  if (error) fail(error)
}
